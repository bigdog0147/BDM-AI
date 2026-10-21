import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "../../../../lib/auth";
import {
  exchangeGoogleCode,
  getGoogleConfig,
  getGoogleJwks,
  GOOGLE_AUTH_COOKIE,
  parseOAuthTransaction,
  safeEqual,
  verifyGoogleIdToken,
  type GoogleAuthErrorCode,
  type GoogleMode
} from "../../../../lib/google-auth";
import {
  createGoogleLink,
  createGoogleUser,
  deleteGoogleLink,
  deleteGoogleUser,
  findGoogleLink,
  findGoogleLinkForUser,
  touchGoogleLink
} from "../../../../lib/google-identity-store";
import { completeGoogleSignIn } from "../../../../lib/google-signin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PendingCookie = { name: string; value: string; options: CookieOptions };

function errorPath(mode: GoogleMode, code: string): string {
  return mode === "link"
    ? `/settings?google_error=${code}`
    : `/auth?error=${code}`;
}

function successPath(mode: GoogleMode): string {
  return mode === "link" ? "/settings?google=linked" : "/";
}

function finalize(
  request: NextRequest,
  mode: GoogleMode,
  path: string,
  pending: PendingCookie[]
): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url));
  for (const cookie of pending) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  response.cookies.set(GOOGLE_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function failureCode(error: GoogleAuthErrorCode): string {
  switch (error) {
    case "email_unverified":
      return "google_email_unverified";
    case "nonce_mismatch":
      return "google_nonce";
    case "token_exchange_failed":
      return "google_token_exchange";
    case "bad_redirect_uri":
      return "google_redirect_uri";
    case "not_configured":
      return "google_not_configured";
    default:
      return "google_token_invalid";
  }
}

/**
 * Google OAuth callback.
 *
 * 1. Validate state and the short-lived httpOnly transaction cookie.
 * 2. Exchange the authorization code with Google using PKCE.
 * 3. Verify the ID token signature, issuer, audience, expiry, nonce, and
 *    verified-email claim.
 * 4. Apply the account-linking policy and establish the existing Supabase
 *    session with `signInWithIdToken`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const transaction = parseOAuthTransaction(
    request.cookies.get(GOOGLE_AUTH_COOKIE)?.value
  );
  const mode: GoogleMode = transaction?.mode ?? "signin";

  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return finalize(
      request,
      mode,
      errorPath(
        mode,
        providerError === "access_denied" ? "google_cancelled" : "google_denied"
      ),
      []
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!transaction || !code || !state || !safeEqual(state, transaction.state)) {
    return finalize(request, mode, errorPath(mode, "google_state"), []);
  }

  const config = getGoogleConfig(request.url);
  if (!config.ok) {
    return finalize(
      request,
      mode,
      errorPath(
        mode,
        config.reason === "bad_redirect_uri"
          ? "google_redirect_uri"
          : "google_not_configured"
      ),
      []
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return finalize(request, mode, errorPath(mode, "auth_not_configured"), []);
  }

  const pending: PendingCookie[] = [];
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          pending.push(cookie);
        }
      }
    }
  });

  let tokens;
  try {
    tokens = await exchangeGoogleCode({
      config: config.config,
      code,
      verifier: transaction.verifier
    });
  } catch (error) {
    const codeValue =
      error && typeof error === "object" && "code" in error
        ? (error.code as GoogleAuthErrorCode)
        : "token_exchange_failed";
    return finalize(
      request,
      mode,
      errorPath(mode, failureCode(codeValue)),
      pending
    );
  }

  let identity;
  try {
    identity = await verifyGoogleIdToken(tokens.idToken, {
      clientId: config.config.clientId,
      nonce: transaction.nonce,
      jwks: getGoogleJwks()
    });
  } catch (error) {
    const codeValue =
      error && typeof error === "object" && "code" in error
        ? (error.code as GoogleAuthErrorCode)
        : "token_invalid";
    return finalize(
      request,
      mode,
      errorPath(mode, failureCode(codeValue)),
      pending
    );
  }

  const result = await completeGoogleSignIn({
    identity,
    mode,
    currentUser: mode === "link" ? await currentUser() : null,
    findLink: findGoogleLink,
    findUserLink: findGoogleLinkForUser,
    createUser: createGoogleUser,
    createLink: createGoogleLink,
    touchLink: touchGoogleLink,
    deleteLink: deleteGoogleLink,
    deleteUser: deleteGoogleUser,
    signInWithIdToken: async () => {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: tokens.idToken,
        access_token: tokens.accessToken ?? undefined,
        nonce: transaction.nonce
      });
      if (error || !data.user) {
        throw new Error("Supabase rejected the Google ID token");
      }
      return { userId: data.user.id };
    },
    signOut: async () => {
      await supabase.auth.signOut();
    }
  });

  if (!result.ok) {
    const codeByReason: Record<typeof result.reason, string> = {
      not_authenticated: "google_sign_in_required",
      email_mismatch: "google_email_mismatch",
      already_linked: "google_already_linked",
      account_exists: "google_account_exists",
      store_unavailable: "google_store_not_configured",
      account_create_failed: "google_account_failed",
      link_failed: "google_link_failed",
      sign_in_failed: "google_sign_in_failed",
      user_mismatch: "google_account_mismatch"
    };
    return finalize(
      request,
      mode,
      errorPath(mode, codeByReason[result.reason]),
      pending
    );
  }

  return finalize(request, mode, successPath(mode), pending);
}

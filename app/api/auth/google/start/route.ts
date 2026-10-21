import { NextResponse } from "next/server";
import { currentUser } from "../../../../../lib/auth";
import {
  buildGoogleAuthorizationUrl,
  createOAuthTransaction,
  getGoogleConfig,
  GOOGLE_AUTH_COOKIE,
  GOOGLE_AUTH_TTL_SECONDS,
  serializeOAuthTransaction,
  type GoogleMode
} from "../../../../../lib/google-auth";
import { googleIdentityStoreConfigured } from "../../../../../lib/google-identity-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorRedirect(
  request: Request,
  mode: GoogleMode,
  code: string
): NextResponse {
  const path =
    mode === "link" ? `/settings?google_error=${code}` : `/auth?error=${code}`;
  return NextResponse.redirect(new URL(path, request.url));
}

/**
 * Start Google OAuth with PKCE, state, and nonce.
 *
 * The Google client secret never leaves the server. The browser only receives
 * a short-lived httpOnly transaction cookie and a redirect to Google.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode: GoogleMode =
    url.searchParams.get("mode") === "link" ? "link" : "signin";

  if (mode === "link" && !(await currentUser())) {
    return errorRedirect(request, mode, "sign_in_required");
  }

  if (!googleIdentityStoreConfigured()) {
    return errorRedirect(request, mode, "google_store_not_configured");
  }

  const config = getGoogleConfig(request.url);
  if (!config.ok) {
    return errorRedirect(
      request,
      mode,
      config.reason === "bad_redirect_uri"
        ? "google_redirect_uri"
        : "google_not_configured"
    );
  }

  const transaction = createOAuthTransaction(mode);
  const response = NextResponse.redirect(
    buildGoogleAuthorizationUrl(config.config, transaction)
  );

  response.cookies.set(
    GOOGLE_AUTH_COOKIE,
    serializeOAuthTransaction(transaction),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GOOGLE_AUTH_TTL_SECONDS
    }
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

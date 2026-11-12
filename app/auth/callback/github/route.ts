import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "../../../../lib/google-auth";
import { findGitHubLink, createGitHubLink, touchGitHubLink, githubIdentityStoreConfigured } from "../../../../lib/github-identity-store";
import { currentUser } from "../../../../lib/auth";
import { requestOrigin } from "../../../../lib/http";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const cookieName = "bdm_github_oauth";
  const cookieValue = request.cookies.get(cookieName)?.value;
  const url = new URL(request.url);

  let transactionState: string | null = null;
  let transactionMode = "signin";
  try {
    if (cookieValue) {
      const parsed = JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8"));
      if (parsed && typeof parsed === "object" && typeof parsed.state === "string" && typeof parsed.mode === "string") {
        transactionState = parsed.state;
        transactionMode = parsed.mode === "link" ? "link" : "signin";
      }
    }
  } catch {
    // malformed cookie
  }

  const mode = transactionMode;
  const pathBase = "/auth";

  const providerError = url.searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(new URL(`${pathBase}?error=github_denied`, requestOrigin(request)));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!cookieValue || !code || !state || !transactionState || !safeEqual(state, transactionState)) {
    return NextResponse.redirect(new URL(`${pathBase}?error=github_state`, requestOrigin(request)));
  }

  // Clear cookie immediately
  const response = NextResponse.redirect(new URL("/", requestOrigin(request)));
  response.cookies.set(cookieName, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });

  try {
    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
    const redirectUri = process.env.GITHUB_REDIRECT_URI?.trim() || new URL("/auth/callback/github", requestOrigin(request)).toString();

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(new URL(`${pathBase}?error=github_not_configured`, requestOrigin(request)));
    }

    // Exchange code for access token via GitHub
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
    });
    if (!tokenResponse.ok) {
      return NextResponse.redirect(new URL(`${pathBase}?error=github_token_exchange`, requestOrigin(request)));
    }
    const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      return NextResponse.redirect(new URL(`${pathBase}?error=github_token_invalid`, requestOrigin(request)));
    }

    // Get user info from GitHub
    const userResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" }
    });
    if (!userResponse.ok) {
      return NextResponse.redirect(new URL(`${pathBase}?error=github_failed`, requestOrigin(request)));
    }
    const githubUser = (await userResponse.json()) as { id: number; email: string | null; login: string; name?: string | null };

    // Get primary email if missing
    let email = githubUser.email;
    if (!email) {
      const emailResponse = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" }
      });
      if (emailResponse.ok) {
        const emails = (await emailResponse.json()) as Array<{ email: string; primary: boolean; verified: boolean } | unknown>;
        const primary = emails.find((e): e is { email: string; primary: boolean; verified: boolean } => typeof e === "object" && e !== null && "primary" in e && (e as { primary: boolean }).primary === true);
        if (primary && primary.verified) email = primary.email;
      }
    }

    if (!email) {
      return NextResponse.redirect(new URL(`${pathBase}?error=github_email_missing`, requestOrigin(request)));
    }

    const githubId = String(githubUser.id);
    const existing = await findGitHubLink(githubId);
    const user = await currentUser();

    // Basic account-linking guard: no implicit link by email alone.
    if (existing.ok && existing.value) {
      if (user && user.id === existing.value.userId) {
        await touchGitHubLink(githubId);
      }
      return NextResponse.redirect(new URL("/?github=linked", requestOrigin(request)));
    }

    if (user && githubIdentityStoreConfigured()) {
      // Link mode or sign-in: create/update link if configured.
      const newLink = await createGitHubLink({ githubId, userId: user.id, email: email ?? "" });
      if (newLink.ok) {
        return NextResponse.redirect(new URL("/?github=linked", requestOrigin(request)));
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.redirect(new URL(`${pathBase}?error=auth_not_configured`, requestOrigin(request)));
    }

    // Session finish: with direct GitHub OAuth the Supabase cookie session
    // is usually established by redirecting through Supabase's /auth/v1/authorize.
    // For this server-controlled flow, redirect to root with a success query
    // so the frontend can call supabase.auth.signInWithOAuth if needed.
    const final = NextResponse.redirect(new URL("/?github=linked", requestOrigin(request)));
    final.cookies.set(cookieName, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    return final;
  } catch {
    return NextResponse.redirect(new URL(`${pathBase}?error=github_failed`, requestOrigin(request)));
  }
}

import { NextResponse } from "next/server";
import { requestOrigin } from "../../../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "link" ? "link" : "signin";

  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const redirectUri =
    process.env.GITHUB_REDIRECT_URI?.trim() ||
    new URL("/auth/callback/github", requestOrigin(request)).toString();

  if (!clientId) {
    const path = mode === "link" ? "/settings?github_error=not_configured" : "/auth?error=github_not_configured";
    return NextResponse.redirect(new URL(path, requestOrigin(request)));
  }

  const state = Buffer.from(JSON.stringify({ mode, createdAt: Date.now() })).toString("base64url");

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", clientId);
  githubUrl.searchParams.set("redirect_uri", redirectUri);
  githubUrl.searchParams.set("scope", "read:user user:email");
  githubUrl.searchParams.set("state", state);
  githubUrl.searchParams.set("response_type", "code");

  const response = NextResponse.redirect(githubUrl.toString());
  response.cookies.set("bdm_github_oauth", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

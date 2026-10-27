import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The Google token exchange is mocked: no credential is used, no network call
 * is made, and no account is created.
 */
const google = vi.hoisted(() => ({
  exchange: vi.fn(),
  verify: vi.fn()
}));

vi.mock("../lib/google-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/google-auth")>();
  return {
    ...actual,
    exchangeGoogleCode: google.exchange,
    verifyGoogleIdToken: google.verify
  };
});

import { GET as googleCallback } from "../app/auth/callback/google/route";
import { GET as googleStart } from "../app/api/auth/google/start/route";
import {
  createOAuthTransaction,
  serializeOAuthTransaction,
  GOOGLE_AUTH_COOKIE,
  GOOGLE_OIDC_CALLBACK_PATH
} from "../lib/google-auth";

/**
 * Google callback route tests.
 *
 * These cover the paths that must fail closed: a missing or mismatched state,
 * a cancelled consent screen, a missing server configuration, and a linking
 * attempt without a signed-in session. None of them reach the token exchange,
 * so no Google credentials are used and no network call is made.
 */

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY"
] as const;

let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];

  google.exchange.mockReset();
  google.exchange.mockResolvedValue({
    idToken: "test-id-token",
    accessToken: null
  });
  google.verify.mockReset();
  google.verify.mockResolvedValue({
    sub: "google-sub-1",
    email: "owner@example.com",
    emailVerified: true,
    name: "Owner",
    picture: null,
    issuer: "https://accounts.google.com",
    audience: "client-id",
    expiresAt: Math.floor(Date.now() / 1000) + 3600
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function callbackRequest(
  url: string,
  options: { mode?: "signin" | "link"; withState?: boolean } = {}
): NextRequest {
  const request = new NextRequest(new URL(url, "https://bdm-ai.onrender.com"));
  if (options.mode) {
    const transaction = createOAuthTransaction(options.mode);
    request.cookies.set(
      GOOGLE_AUTH_COOKIE,
      serializeOAuthTransaction(transaction)
    );
    if (options.withState) {
      const next = new URL(request.url);
      next.searchParams.set("state", transaction.state);
      return new NextRequest(next, {
        headers: {
          cookie: request.cookies
            .getAll()
            .map((cookie) => `${cookie.name}=${cookie.value}`)
            .join("; ")
        }
      });
    }
  }
  return request;
}

function locationOf(response: Response): string {
  return response.headers.get("location") ?? "";
}

describe("GET /auth/callback/google", () => {
  it("rejects a callback with no state and no transaction", async () => {
    const response = await googleCallback(
      callbackRequest("/auth/callback/google?code=abc")
    );
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(locationOf(response)).toContain("/auth?error=google_state");
  });

  it("rejects a callback whose state does not match the transaction", async () => {
    const request = callbackRequest("/auth/callback/google?code=abc&state=wrong", {
      mode: "signin"
    });
    const response = await googleCallback(request);
    expect(locationOf(response)).toContain("/auth?error=google_state");
  });

  it("reports a cancelled consent screen", async () => {
    const response = await googleCallback(
      callbackRequest("/auth/callback/google?error=access_denied")
    );
    expect(locationOf(response)).toContain("/auth?error=google_cancelled");
  });

  it("reports a denied consent screen distinctly", async () => {
    const response = await googleCallback(
      callbackRequest("/auth/callback/google?error=access_denied_other")
    );
    expect(locationOf(response)).toContain("/auth?error=google_denied");
  });

  it("fails closed when the server has no Google credentials", async () => {
    const response = await googleCallback(
      callbackRequest("/auth/callback/google?code=abc", {
        mode: "signin",
        withState: true
      })
    );
    expect(locationOf(response)).toContain("/auth?error=google_not_configured");
  });

  it("refuses a linking attempt that has no signed-in session", async () => {
    // Google credentials and Supabase are present, so the flow reaches the
    // linking check - and there is no session, so it must refuse.
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_REDIRECT_URI =
      "https://bdm-ai.onrender.com/auth/callback/google";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

    const response = await googleCallback(
      callbackRequest("/auth/callback/google?code=abc", {
        mode: "link",
        withState: true
      })
    );
    // A linking failure returns to the page that started it.
    expect(locationOf(response)).toContain(
      "/settings?google_error=google_sign_in_required"
    );
  });

  it("does not call the token exchange when the state does not match", async () => {
    const response = await googleCallback(
      callbackRequest("/auth/callback/google?code=abc&state=wrong", {
        mode: "signin"
      })
    );
    expect(locationOf(response)).toContain("/auth?error=google_state");
    expect(google.exchange).not.toHaveBeenCalled();
  });

  it("does not call the token exchange when the server is not configured", async () => {
    const response = await googleCallback(
      callbackRequest("/auth/callback/google?code=abc", {
        mode: "signin",
        withState: true
      })
    );
    expect(locationOf(response)).toContain("/auth?error=google_not_configured");
    expect(google.exchange).not.toHaveBeenCalled();
  });

  it("verifies the ID token before trusting the identity", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_REDIRECT_URI =
      "https://bdm-ai.onrender.com/auth/callback/google";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

    google.verify.mockRejectedValue(
      Object.assign(new Error("invalid"), { code: "token_invalid" })
    );

    const response = await googleCallback(
      callbackRequest("/auth/callback/google?code=abc", {
        mode: "signin",
        withState: true
      })
    );
    expect(locationOf(response)).toContain("/auth?error=google_token_invalid");
  });

  it("clears the transaction cookie on every failure", async () => {
    const response = await googleCallback(
      callbackRequest("/auth/callback/google?code=abc")
    );
    const cleared = response.headers
      .getSetCookie?.()
      .find((cookie) => cookie.startsWith(`${GOOGLE_AUTH_COOKIE}=`));
    expect(cleared).toBeTruthy();
    expect(cleared).toContain("Max-Age=0");
  });

  it("never leaks the transaction cookie value into the redirect", async () => {
    const transaction = createOAuthTransaction("signin");
    const request = callbackRequest(
      `/auth/callback/google?code=abc&state=${transaction.state}`,
      { mode: "signin" }
    );
    const response = await googleCallback(request);
    const location = locationOf(response);

    expect(location).not.toContain(transaction.state);
    expect(location).not.toContain(transaction.verifier);
    expect(location).not.toContain(transaction.nonce);
    expect(location).not.toContain("code=abc");
  });
});

describe("GET /api/auth/google/start", () => {
  it("redirects to the account screen when the server is not configured", async () => {
    const request = new NextRequest(
      new URL("https://bdm-ai.onrender.com/api/auth/google/start")
    );
    const response = await googleStart(request);
    expect(locationOf(response)).toContain(
      "/auth?error=google_store_not_configured"
    );
  });

  it("refuses to start a linking flow without a session", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";

    const request = new NextRequest(
      new URL(
        "https://bdm-ai.onrender.com/api/auth/google/start?mode=link"
      )
    );
    const response = await googleStart(request);
    expect(locationOf(response)).toContain(
      "/settings?google_error=sign_in_required"
    );
  });

  it("sends the browser to Google with the required parameters", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";

    const request = new NextRequest(
      new URL("https://bdm-ai.onrender.com/api/auth/google/start")
    );
    const response = await googleStart(request);
    const location = locationOf(response);

    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location).toContain("scope=openid+email+profile");
    expect(location).toContain("code_challenge_method=S256");
    expect(location).toContain("response_type=code");
    // The client secret must never appear in the browser redirect.
    expect(location).not.toContain("client-secret");
  });

  it("registers the callback path it actually serves", () => {
    expect(GOOGLE_OIDC_CALLBACK_PATH).toBe("/auth/callback/google");
  });
});

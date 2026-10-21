import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Public origin tests for the Google sign-in flow.
 *
 * Behind a proxy, Next.js builds `request.url` from the server's own
 * hostname and port, not from the host the visitor used. On Render that is
 * `https://localhost:10000/...` even though the app is reached at the
 * custom domain. A redirect built from `request.url` therefore points at an
 * address nothing is listening on, and the user sees a connection error
 * instead of being signed in.
 *
 * These tests reproduce that topology exactly and assert every absolute URL
 * the flow produces is built from the public origin.
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
  GOOGLE_AUTH_COOKIE
} from "../lib/google-auth";
import { requestOrigin } from "../lib/http";

/** The address the user actually typed. */
const PUBLIC_ORIGIN = "https://bdmai.cloud";
/** The address Next.js believes the server is listening on. */
const INTERNAL_ORIGIN = "https://localhost:10000";

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

/** NextRequest's own init type, which is stricter than the DOM RequestInit. */
type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

/**
 * A request as Next.js sees it behind Render: the URL carries the server's
 * internal address while the forwarded headers carry the public one.
 */
function proxiedRequest(path: string, init?: NextRequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("x-forwarded-host", "bdmai.cloud");
  headers.set("x-forwarded-proto", "https");
  return new NextRequest(new URL(path, INTERNAL_ORIGIN), { ...init, headers });
}

function locationOf(response: Response): string {
  return response.headers.get("location") ?? "";
}

describe("public origin behind a proxy", () => {
  it("resolves the public origin, not the internal address", () => {
    expect(requestOrigin(proxiedRequest("/api/status"))).toBe(PUBLIC_ORIGIN);
  });

  it("falls back to the Host header when no forwarded host is present", () => {
    const request = new NextRequest(new URL("/api/status", INTERNAL_ORIGIN), {
      headers: { host: "bdmai.cloud" }
    });
    expect(requestOrigin(request)).toBe(PUBLIC_ORIGIN);
  });

  it("rejects a malformed host instead of putting it in a Location header", () => {
    const request = new NextRequest(new URL("/api/status", INTERNAL_ORIGIN), {
      headers: { "x-forwarded-host": "bdmai.cloud/evil" }
    });
    expect(requestOrigin(request)).not.toContain("evil");
  });
});

describe("Google callback redirects", () => {
  it("sends a cancelled consent screen back to the public auth page", async () => {
    const response = await googleCallback(
      proxiedRequest("/auth/callback/google?error=access_denied")
    );

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe(
      `${PUBLIC_ORIGIN}/auth?error=google_cancelled`
    );
  });

  it("sends a failed state check back to the public auth page", async () => {
    const response = await googleCallback(
      proxiedRequest("/auth/callback/google?code=fake&state=fake")
    );

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe(`${PUBLIC_ORIGIN}/auth?error=google_state`);
  });

  it("sends a missing configuration back to the public auth page", async () => {
    // No client credentials, so the flow stops before the token exchange.
    const response = await googleCallback(
      proxiedRequest("/auth/callback/google?error=server_error")
    );

    expect(locationOf(response)).toContain(PUBLIC_ORIGIN);
  });

  it("never redirects to the internal address", async () => {
    const response = await googleCallback(
      proxiedRequest("/auth/callback/google?code=fake&state=fake")
    );

    expect(locationOf(response)).not.toContain("localhost:10000");
  });
});

describe("Google sign-in start redirects", () => {
  it("sends an unconfigured server back to the public auth page", async () => {
    const response = await googleStart(
      proxiedRequest("/api/auth/google/start")
    );

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe(
      `${PUBLIC_ORIGIN}/auth?error=google_store_not_configured`
    );
  });

  it("never redirects to the internal address", async () => {
    const response = await googleStart(
      proxiedRequest("/api/auth/google/start")
    );

    expect(locationOf(response)).not.toContain("localhost:10000");
  });

  it("derives the callback URL from the public origin", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    // The identity store is checked first, so it has to be configured for the
    // flow to reach the point where the callback URL is derived.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    // No GOOGLE_REDIRECT_URI: the callback is derived from the request.

    const response = await googleStart(
      proxiedRequest("/api/auth/google/start")
    );

    const location = locationOf(response);
    expect(location).toContain(
      `redirect_uri=${encodeURIComponent(`${PUBLIC_ORIGIN}/auth/callback/google`)}`
    );
  });
});

describe("Google callback cookie handling", () => {
  it("clears the transaction cookie on the public origin", async () => {
    const transaction = createOAuthTransaction("signin");
    const cookie = `${GOOGLE_AUTH_COOKIE}=${serializeOAuthTransaction(transaction)}`;

    const response = await googleCallback(
      proxiedRequest("/auth/callback/google?error=access_denied", {
        headers: { cookie }
      })
    );

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${GOOGLE_AUTH_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
  });
});

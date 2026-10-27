import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";

// Mock jose
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import {
  createOAuthTransaction,
  createPkcePair,
  serializeOAuthTransaction,
  parseOAuthTransaction,
  safeEqual,
  getGoogleConfig,
  googleCallbackUrl,
  googleAuthConfigured,
  buildGoogleAuthorizationUrl,
  getGoogleJwks,
  verifyGoogleIdToken,
  exchangeGoogleCode,
  GOOGLE_AUTH_COOKIE,
  GOOGLE_AUTH_TTL_SECONDS,
  GoogleAuthError,
  GoogleAuthErrorCode,
} from "../lib/google-auth";

const TEST_URL = "http://localhost:3000";
const TEST_CLIENT_ID = "test-client-id";
const TEST_CLIENT_SECRET = "test-client-secret";
const TEST_REDIRECT_URI = "http://localhost:3000/auth/callback/google";

beforeEach(() => {
  vi.resetModules();
  process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = TEST_CLIENT_SECRET;
  process.env.GOOGLE_REDIRECT_URI = TEST_REDIRECT_URI;
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  vi.clearAllMocks();
});

describe("google-auth: PKCE & transaction handling", () => {
  it("creates a PKCE pair with valid verifier and challenge", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toHaveLength(43); // base64url 32 bytes
    expect(challenge).toHaveLength(43);
  });

  it("creates an OAuth transaction with all required fields", () => {
    const tx = createOAuthTransaction("signin");
    expect(tx.state).toHaveLength(43);
    expect(tx.nonce).toHaveLength(22);
    expect(tx.verifier).toHaveLength(43);
    expect(tx.challenge).toHaveLength(43);
    expect(tx.mode).toBe("signin");
    expect(tx.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("serializes and parses transaction round-trip", () => {
    const tx = createOAuthTransaction("link");
    const serialized = serializeOAuthTransaction(tx);
    const parsed = parseOAuthTransaction(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.state).toBe(tx.state);
    expect(parsed!.nonce).toBe(tx.nonce);
    expect(parsed!.verifier).toBe(tx.verifier);
    expect(parsed!.challenge).toBe(tx.challenge);
    expect(parsed!.mode).toBe("link");
  });

  it("rejects expired transaction", () => {
    const tx = createOAuthTransaction("signin");
    tx.createdAt = Date.now() - (GOOGLE_AUTH_TTL_SECONDS + 1) * 1000;
    const serialized = serializeOAuthTransaction(tx);
    const parsed = parseOAuthTransaction(serialized);
    expect(parsed).toBeNull();
  });

  it("rejects malformed transaction cookie", () => {
    expect(parseOAuthTransaction("not-base64")).toBeNull();
    expect(parseOAuthTransaction(Buffer.from("{}").toString("base64url"))).toBeNull();
    expect(parseOAuthTransaction(null)).toBeNull();
  });

  it("safeEqual uses constant-time comparison", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "def")).toBe(false);
    expect(safeEqual("a", "aa")).toBe(false);
  });
});

describe("google-auth: configuration", () => {
  it("reports configured when both env vars present", () => {
    expect(googleAuthConfigured()).toBe(true);
  });

  it("reports not configured when client ID missing", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(googleAuthConfigured()).toBe(false);
  });

  it("reports not configured when client secret missing", () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleAuthConfigured()).toBe(false);
  });

  it("getGoogleConfig returns config with explicit redirect URI", () => {
    const result = getGoogleConfig(TEST_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.clientId).toBe(TEST_CLIENT_ID);
      expect(result.config.clientSecret).toBe(TEST_CLIENT_SECRET);
      expect(result.config.redirectUri).toBe(TEST_REDIRECT_URI);
    }
  });

  it("getGoogleConfig derives redirect URI from request when env unset", () => {
    delete process.env.GOOGLE_REDIRECT_URI;
    const result = getGoogleConfig(TEST_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.redirectUri).toBe(`${TEST_URL}/auth/callback/google`);
    }
  });

  it("getGoogleConfig rejects non-HTTPS redirect URI (non-localhost)", () => {
    process.env.GOOGLE_REDIRECT_URI = "http://example.com/auth/callback/google";
    const result = getGoogleConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_redirect_uri");
  });

  it("googleCallbackUrl returns explicit URI when set", () => {
    const url = googleCallbackUrl(TEST_URL);
    expect(url).toBe(TEST_REDIRECT_URI);
  });

  it("googleCallbackUrl derives from request when env unset", () => {
    delete process.env.GOOGLE_REDIRECT_URI;
    const url = googleCallbackUrl(TEST_URL);
    expect(url).toBe(`${TEST_URL}/auth/callback/google`);
  });
});

describe("google-auth: authorization URL", () => {
  it("builds Google authorize URL with all required params", () => {
    const tx = createOAuthTransaction("signin");
    const config = getGoogleConfig(TEST_URL);
    if (!config.ok) throw new Error("config failed");
    const url = buildGoogleAuthorizationUrl(config.config, tx);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe(TEST_CLIENT_ID);
    expect(u.searchParams.get("redirect_uri")).toBe(TEST_REDIRECT_URI);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("state")).toBe(tx.state);
    expect(u.searchParams.get("nonce")).toBe(tx.nonce);
    expect(u.searchParams.get("code_challenge")).toBe(tx.challenge);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("prompt")).toBe("select_account");
  });
});

describe("google-auth: ID token verification", () => {
  const mockPayload = {
    sub: "google-sub-123",
    email: "test@example.com",
    email_verified: true,
    name: "Test User",
    picture: "https://example.com/photo.jpg",
    iss: "https://accounts.google.com",
    aud: TEST_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: "test-nonce",
  };

  it("verifies valid ID token with matching nonce", async () => {
    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: mockPayload, protectedHeader: { alg: "RS256" } });

    const identity = await verifyGoogleIdToken("valid-token", {
      clientId: TEST_CLIENT_ID,
      nonce: "test-nonce",
      jwks: getGoogleJwks(),
    });

    expect(identity.sub).toBe("google-sub-123");
    expect(identity.email).toBe("test@example.com");
    expect(identity.emailVerified).toBe(true);
    expect(identity.name).toBe("Test User");
  });

  it("rejects token with invalid signature", async () => {
    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error("invalid signature"));

    await expect(verifyGoogleIdToken("bad-token", {
      clientId: TEST_CLIENT_ID,
      nonce: "test-nonce",
      jwks: getGoogleJwks(),
    })).rejects.toThrow(GoogleAuthError);
  });

  it("rejects token with mismatched nonce", async () => {
    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: { ...mockPayload, nonce: "wrong-nonce" }, protectedHeader: { alg: "RS256" } });

    await expect(verifyGoogleIdToken("token", {
      clientId: TEST_CLIENT_ID,
      nonce: "test-nonce",
      jwks: getGoogleJwks(),
    })).rejects.toThrow(GoogleAuthError);
  });

  it("rejects token with unverified email", async () => {
    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: { ...mockPayload, email_verified: false }, protectedHeader: { alg: "RS256" } });

    await expect(verifyGoogleIdToken("token", {
      clientId: TEST_CLIENT_ID,
      nonce: "test-nonce",
      jwks: getGoogleJwks(),
    })).rejects.toThrow(GoogleAuthError);
  });

  it("rejects token missing required claims", async () => {
    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: { sub: "123" }, protectedHeader: { alg: "RS256" } });

    await expect(verifyGoogleIdToken("token", {
      clientId: TEST_CLIENT_ID,
      nonce: "test-nonce",
      jwks: getGoogleJwks(),
    })).rejects.toThrow(GoogleAuthError);
  });
});

describe("google-auth: code exchange", () => {
  it("exchanges authorization code for tokens", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id_token: "id-token-123",
        access_token: "access-token-456",
      }),
    });

    const tokens = await exchangeGoogleCode({
      config: {
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        redirectUri: TEST_REDIRECT_URI,
      },
      code: "auth-code-123",
      verifier: "verifier-123",
    });

    expect(tokens.idToken).toBe("id-token-123");
    expect(tokens.accessToken).toBe("access-token-456");
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("https://oauth2.googleapis.com/token");
    const init = fetchCall[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect(body.get("code")).toBe("auth-code-123");
    expect(body.get("client_id")).toBe(TEST_CLIENT_ID);
    expect(body.get("client_secret")).toBe(TEST_CLIENT_SECRET);
    expect(body.get("redirect_uri")).toBe(TEST_REDIRECT_URI);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("verifier-123");
  });

  it("throws on token endpoint error", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
    });

    await expect(exchangeGoogleCode({
      config: { clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET, redirectUri: TEST_REDIRECT_URI },
      code: "bad-code",
      verifier: "verifier",
    })).rejects.toThrow(GoogleAuthError);
  });

  it("throws on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network error"));

    await expect(exchangeGoogleCode({
      config: { clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET, redirectUri: TEST_REDIRECT_URI },
      code: "code",
      verifier: "verifier",
    })).rejects.toThrow(GoogleAuthError);
  });
});
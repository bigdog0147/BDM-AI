import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload
} from "jose";

/**
 * Server-side Google OpenID Connect support.
 *
 * This module deliberately contains no Supabase code. It performs the OAuth
 * authorization-code exchange with PKCE and verifies the Google ID token
 * against Google's published JWKS. The caller then uses Supabase Auth to
 * establish the existing httpOnly cookie session.
 *
 * Security properties:
 *  - state, nonce, and PKCE verifier are generated per attempt and stored in a
 *    short-lived httpOnly cookie
 *  - the ID token signature, issuer, audience, expiry, nonce, and verified-email
 *    claim are all checked before the identity is trusted
 *  - no token, secret, or raw provider response is logged
 */

export const GOOGLE_AUTH_COOKIE = "bdm_google_oauth";
export const GOOGLE_AUTH_TTL_SECONDS = 10 * 60;
export const GOOGLE_OIDC_CALLBACK_PATH = "/auth/callback/google";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type GoogleMode = "signin" | "link";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export type GoogleConfigResult =
  | { ok: true; config: GoogleConfig }
  | { ok: false; reason: "not_configured" | "bad_redirect_uri" };

export interface GoogleOAuthTransaction {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
  mode: GoogleMode;
  createdAt: number;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: true;
  name: string | null;
  picture: string | null;
  issuer: string;
  audience: string;
  expiresAt: number;
}

export interface GoogleTokenSet {
  idToken: string;
  accessToken: string | null;
}

export type GoogleAuthErrorCode =
  | "not_configured"
  | "bad_redirect_uri"
  | "state_invalid"
  | "token_exchange_failed"
  | "token_invalid"
  | "missing_claims"
  | "email_unverified"
  | "nonce_mismatch";

export class GoogleAuthError extends Error {
  readonly code: GoogleAuthErrorCode;

  constructor(code: GoogleAuthErrorCode) {
    super(code);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time comparison for the OAuth state value. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthTransaction(mode: GoogleMode): GoogleOAuthTransaction {
  const { verifier, challenge } = createPkcePair();
  return {
    state: randomToken(32),
    nonce: randomToken(16),
    verifier,
    challenge,
    mode,
    createdAt: Date.now()
  };
}

export function serializeOAuthTransaction(
  transaction: GoogleOAuthTransaction
): string {
  return Buffer.from(JSON.stringify(transaction)).toString("base64url");
}

/**
 * Parse the OAuth transaction cookie and reject expired or malformed values.
 * The caller still compares the returned `state` with the query parameter.
 */
export function parseOAuthTransaction(
  value: string | undefined | null,
  now = Date.now()
): GoogleOAuthTransaction | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<GoogleOAuthTransaction>;

    if (
      typeof parsed.state !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.challenge !== "string" ||
      typeof parsed.createdAt !== "number" ||
      (parsed.mode !== "signin" && parsed.mode !== "link")
    ) {
      return null;
    }
    if (parsed.state.length < 32 || parsed.nonce.length < 16) return null;
    if (parsed.verifier.length < 32 || parsed.challenge.length < 32) return null;
    if (now - parsed.createdAt > GOOGLE_AUTH_TTL_SECONDS * 1000) return null;
    if (parsed.createdAt > now + 60_000) return null;

    return {
      state: parsed.state,
      nonce: parsed.nonce,
      verifier: parsed.verifier,
      challenge: parsed.challenge,
      mode: parsed.mode,
      createdAt: parsed.createdAt
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the Google OAuth client configuration.
 *
 * `GOOGLE_REDIRECT_URI` is optional; when it is unset the callback URL is
 * derived from the incoming request. Production should set it explicitly so
 * the value registered in Google Cloud Console cannot drift.
 */
export function getGoogleConfig(requestUrl?: string): GoogleConfigResult {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return { ok: false, reason: "not_configured" };
  }

  const configuredUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  let redirectUri = configuredUri ?? "";
  if (!redirectUri && requestUrl) {
    // Must match the route that actually handles the callback:
    // app/auth/callback/google/route.ts
    redirectUri = new URL(GOOGLE_OIDC_CALLBACK_PATH, requestUrl).toString();
  }
  if (!redirectUri) return { ok: false, reason: "not_configured" };

  try {
    const parsed = new URL(redirectUri);
    const isLocal =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
      return { ok: false, reason: "bad_redirect_uri" };
    }
    return {
      ok: true,
      config: {
        clientId,
        clientSecret,
        redirectUri: parsed.toString()
      }
    };
  } catch {
    return { ok: false, reason: "bad_redirect_uri" };
  }
}

export function googleAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

/** The exact callback URL to register in Google Cloud Console. */
export function googleCallbackUrl(requestUrl: string): string {
  return (
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    new URL(GOOGLE_OIDC_CALLBACK_PATH, requestUrl).toString()
  );
}

/* ================================================================
 * Legacy Supabase-managed Google OAuth (kept for backward compatibility)
 * These use Supabase Auth's built-in OAuth flow with PKCE.
 * ================================================================ */

export const GOOGLE_CALLBACK_PATH = "/auth/callback";

const STATUS_TTL_MS = 60_000;

export type GoogleProviderStatus = {
  available: boolean;
  checked: boolean;
  reason: string | null;
};

export type ProvidersStatus = {
  supabaseConfigured: boolean;
  google: GoogleProviderStatus;
};

let cached: { at: number; value: ProvidersStatus } | null = null;

/** Test helper: drops the short-lived provider status cache. */
export function resetGoogleProviderCache(): void {
  cached = null;
}

/**
 * Ask the Supabase Auth server whether the Google provider is enabled.
 */
export async function googleProviderStatus(options?: {
  fresh?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<ProvidersStatus> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !key) {
    return {
      supabaseConfigured: false,
      google: { available: false, checked: false, reason: "supabase_not_configured" }
    };
  }

  const now = Date.now();
  if (!options?.fresh && cached && now - cached.at < STATUS_TTL_MS) {
    return cached.value;
  }

  const doFetch = options?.fetchImpl ?? fetch;

  try {
    const response = await doFetch(`${url}/auth/v1/settings`, {
      method: "GET",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        accept: "application/json"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(options?.timeoutMs ?? 2500)
    });

    if (!response.ok) {
      throw new Error(`supabase settings ${response.status}`);
    }

    const data = (await response.json()) as {
      external?: Record<string, unknown>;
    };
    const available = data.external?.google === true;

    const value: ProvidersStatus = {
      supabaseConfigured: true,
      google: {
        available,
        checked: true,
        reason: available ? null : "google_not_enabled"
      }
    };
    cached = { at: now, value };
    return value;
  } catch {
    return {
      supabaseConfigured: true,
      google: { available: false, checked: false, reason: "provider_status_unavailable" }
    };
  }
}

/**
 * Only same-site, relative paths are accepted as a post-login destination.
 */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  // Check for control characters without a control-char regex literal
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f) return "/";
  }
  return value;
}

/**
 * User-facing text for an OAuth failure code.
 */
export function googleErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "access_denied":
      return "Google sign-in was cancelled or consent was denied. Nothing was changed.";
    case "otp_expired":
    case "invalid_request":
      return "That sign-in link expired. Please start again.";
    case "google_not_enabled":
      return "Google sign-in is not enabled for this project yet.";
    case "supabase_not_configured":
      return "Sign-in is not configured on this server yet.";
    case "google_start_failed":
      return "Google sign-in could not be started. Please try again.";
    case "google_failed":
      return "Google sign-in could not be completed. Please try again.";
    case "rate_limited":
      return "Too many sign-in attempts. Please wait a moment and try again.";
    case null:
    case undefined:
    case "":
      return "";
    default:
      return "Google sign-in could not be completed. Please try again.";
  }
}

export function buildGoogleAuthorizationUrl(
  config: GoogleConfig,
  transaction: GoogleOAuthTransaction
): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", transaction.state);
  url.searchParams.set("nonce", transaction.nonce);
  url.searchParams.set("code_challenge", transaction.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("access_type", "online");
  return url.toString();
}

let remoteJwks: JWTVerifyGetKey | null = null;

/** Lazily created remote key set, cached by `jose` between requests. */
export function getGoogleJwks(): JWTVerifyGetKey {
  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), {
      cacheMaxAge: 10 * 60_000,
      cooldownDuration: 30_000
    });
  }
  return remoteJwks;
}

function stringClaim(payload: JWTPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value ? value : null;
}

/**
 * Verify a Google ID token and return only the identity claims we rely on.
 * The JWKS parameter is injectable so tests never touch the network.
 */
export async function verifyGoogleIdToken(
  token: string,
  options: {
    clientId: string;
    nonce: string;
    jwks: JWTVerifyGetKey;
  }
): Promise<GoogleIdentity> {
  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(token, options.jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: options.clientId,
      clockTolerance: 5
    });
    payload = verified.payload;
  } catch {
    throw new GoogleAuthError("token_invalid");
  }

  const sub = stringClaim(payload, "sub");
  const email = stringClaim(payload, "email");
  const issuer = stringClaim(payload, "iss");
  const audience =
    typeof payload.aud === "string"
      ? payload.aud
      : Array.isArray(payload.aud)
        ? payload.aud[0] ?? null
        : null;

  if (!sub || !email || !issuer || !audience) {
    throw new GoogleAuthError("missing_claims");
  }

  if (payload.email_verified !== true && payload.email_verified !== "true") {
    throw new GoogleAuthError("email_unverified");
  }

  if (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, options.nonce)) {
    throw new GoogleAuthError("nonce_mismatch");
  }

  return {
    sub,
    email,
    emailVerified: true,
    name: stringClaim(payload, "name"),
    picture: stringClaim(payload, "picture"),
    issuer,
    audience,
    expiresAt: typeof payload.exp === "number" ? payload.exp : 0
  };
}

/**
 * Exchange the Google authorization code for tokens. The caller must verify
 * the returned ID token before using it.
 */
export async function exchangeGoogleCode(options: {
  config: GoogleConfig;
  code: string;
  verifier: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleTokenSet> {
  const body = new URLSearchParams({
    code: options.code,
    client_id: options.config.clientId,
    client_secret: options.config.clientSecret,
    redirect_uri: options.config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: options.verifier
  });

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body,
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new GoogleAuthError("token_exchange_failed");
  }

  if (!response.ok) {
    throw new GoogleAuthError("token_exchange_failed");
  }

  let json: { id_token?: unknown; access_token?: unknown };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    throw new GoogleAuthError("token_exchange_failed");
  }

  if (typeof json.id_token !== "string" || !json.id_token) {
    throw new GoogleAuthError("token_exchange_failed");
  }

  return {
    idToken: json.id_token,
    accessToken:
      typeof json.access_token === "string" && json.access_token
        ? json.access_token
        : null
  };
}
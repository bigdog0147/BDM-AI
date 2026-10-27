import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Svix-compatible webhook signature verification, as used by Resend.
 *
 * The signed content is `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256
 * with the base64-decoded `whsec_…` secret, compared in constant time. A
 * timestamp outside the tolerance window is rejected so a captured request
 * cannot be replayed indefinitely.
 *
 * Pure and dependency-free so it can be tested without a provider call.
 */

export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SvixFailure =
  | "not_configured"
  | "missing_headers"
  | "bad_timestamp"
  | "stale"
  | "bad_signature";

export type SvixVerification =
  | { ok: true }
  | { ok: false; reason: SvixFailure };

export interface SvixInput {
  secret: string | null | undefined;
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}

export function verifySvixSignature(input: SvixInput): SvixVerification {
  const secret = input.secret?.trim();
  if (!secret) return { ok: false, reason: "not_configured" };

  if (!input.id || !input.timestamp || !input.signature) {
    return { ok: false, reason: "missing_headers" };
  }

  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "bad_timestamp" };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) {
    return { ok: false, reason: "stale" };
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (secretBytes.length === 0) return { ok: false, reason: "not_configured" };

  const expected = createHmac("sha256", secretBytes)
    .update(`${input.id}.${input.timestamp}.${input.body}`)
    .digest();

  // The header can carry several space-separated `v1,<base64>` candidates.
  for (const candidate of input.signature.split(" ")) {
    const [version, encoded] = candidate.split(",");
    if (version !== "v1" || !encoded) continue;

    const provided = Buffer.from(encoded, "base64");
    if (
      provided.length === expected.length &&
      timingSafeEqual(provided, expected)
    ) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "bad_signature" };
}

export const RESEND_EVENT_TYPES = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.complained",
  "email.bounced",
  "email.opened",
  "email.clicked"
] as const;

export type ResendEventType = (typeof RESEND_EVENT_TYPES)[number];

const EVENT_TYPE_SET = new Set<string>(RESEND_EVENT_TYPES);

export interface NormalizedEmailEvent {
  eventType: ResendEventType;
  eventId: string;
  emailId: string | null;
  provider: "resend";
  occurredAt: string | null;
}

/**
 * Reduce a verified payload to the fields we are willing to store.
 *
 * Recipients, subjects, and bodies are deliberately excluded: delivery state
 * is useful, the content of someone's email is not.
 */
export function normalizeResendEvent(
  payload: unknown,
  eventId: string
): NormalizedEmailEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    type?: unknown;
    created_at?: unknown;
    data?: { email_id?: unknown };
  };

  if (typeof record.type !== "string" || !EVENT_TYPE_SET.has(record.type)) {
    return null;
  }

  const emailId =
    record.data && typeof record.data.email_id === "string"
      ? record.data.email_id
      : null;

  return {
    eventType: record.type as ResendEventType,
    eventId,
    emailId,
    provider: "resend",
    occurredAt: typeof record.created_at === "string" ? record.created_at : null
  };
}

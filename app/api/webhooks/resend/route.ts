import { NextResponse } from "next/server";
import { recordEmailEvent, webhookStorageConfigured } from "../../../../lib/email-events";
import { normalizeResendEvent, verifySvixSignature } from "../../../../lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

/**
 * POST /api/webhooks/resend
 *
 * Receives Resend delivery events. Authentication is the Svix signature over
 * the raw body, not a session: the endpoint is intentionally unauthenticated
 * but rejects anything that is not signed with RESEND_WEBHOOK_SECRET.
 *
 * Responses:
 *   200 verified (stored or explicitly not stored)
 *   400 malformed body
 *   401 missing/stale/bad signature
 *   503 webhook or storage unavailable, so the provider retries
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook verification is not configured." },
      { status: 503 }
    );
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const verification = verifySvixSignature({
    secret,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    body
  });

  if (!verification.ok) {
    if (verification.reason === "not_configured") {
      return NextResponse.json(
        { error: "Webhook verification is not configured." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventId = request.headers.get("svix-id") as string;
  const event = normalizeResendEvent(payload, eventId);

  if (!event) {
    // Verified but not an event we record. Acknowledge so it is not retried.
    return NextResponse.json({ ok: true, ignored: true, stored: false });
  }

  const result = await recordEmailEvent(event);

  if (!result.ok) {
    if (result.reason === "not_configured") {
      // Honest, non-retrying acknowledgement: the signature was valid, but
      // durable storage is not available.
      return NextResponse.json({
        ok: true,
        stored: false,
        storage: "not_configured"
      });
    }
    // A real storage failure is retryable.
    return NextResponse.json(
      { error: "Event storage failed." },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ok: true,
    stored: true,
    duplicate: result.duplicate,
    storage: webhookStorageConfigured() ? "service_role" : "not_configured"
  });
}

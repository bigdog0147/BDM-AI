import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/auth";
import { recordAuditEvent } from "../../../../lib/audit";
import { emailStatus, sendEmail, validateEmailInput } from "../../../../lib/email";
import { consumeUserQuota, quotaLimits, retryAfterSeconds } from "../../../../lib/quota";
import { createRateLimiter } from "../../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Secondary guard against a double click; the durable quota is the control. */
const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });

const SEND_STATUS = {
  not_configured: 503,
  unauthorized: 502,
  rate_limited: 429,
  rejected: 422,
  timeout: 504,
  failed: 502
} as const;

/**
 * POST /api/email/send
 *
 * Body: { to, subject, body, confirmed: true }
 *
 * The body must carry an explicit `confirmed: true`. The UI only sets it
 * after the user has reviewed the exact recipient, subject, and body, so an
 * AI-composed draft cannot be sent by the model itself.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const burst = limiter.check(user.id);
  if (burst.limited) {
    return NextResponse.json(
      { error: "Too many send attempts. Please wait a minute." },
      { status: 429, headers: { "retry-after": String(burst.retryAfterSeconds) } }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = (payload ?? {}) as {
    to?: unknown;
    subject?: unknown;
    body?: unknown;
    confirmed?: unknown;
  };

  const validated = validateEmailInput(input);
  if (!validated.ok) {
    const message =
      validated.reason === "too_many_recipients"
        ? "Only one recipient is supported"
        : validated.reason === "bad_subject"
          ? "A subject is required and must be a single line"
          : validated.reason === "bad_body"
            ? "A message body is required"
            : validated.reason === "too_long"
              ? "The message is too long"
              : "A valid recipient email address is required";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (input.confirmed !== true) {
    return NextResponse.json(
      {
        error:
          "Review the recipient, subject, and body, then confirm sending.",
        needsConfirmation: true
      },
      { status: 400 }
    );
  }

  const status = emailStatus();
  if (!status.configured) {
    return NextResponse.json(
      {
        error:
          "Email sending is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL on the server and set BDM_EMAIL_ENABLED=true.",
        configured: false
      },
      { status: 503 }
    );
  }

  // Reservation happens before the provider call: a timed-out send may still
  // have been accepted, so it must count against the allowance.
  const quota = await consumeUserQuota(
    "email.send",
    "day",
    quotaLimits().emailDaily
  );
  if (!quota.ok) {
    if (quota.reason === "limited") {
      return NextResponse.json(
        {
          error: `Daily email limit (${quota.limit}) reached. Try again after ${quota.resetAt}.`,
          resetAt: quota.resetAt
        },
        { status: 429, headers: { "retry-after": String(retryAfterSeconds(quota.resetAt)) } }
      );
    }
    return NextResponse.json(
      {
        error:
          "The usage quota store is not available, so sending is disabled to prevent unbounded spend.",
        reason: "quota_unavailable"
      },
      { status: 503 }
    );
  }

  const result = await sendEmail({
    to: validated.to,
    subject: validated.subject,
    body: validated.body
  });

  void recordAuditEvent({
    userId: user.id,
    eventType: "email",
    action: "send",
    status: result.ok ? "success" : "failure",
    toolKey: "email.send",
    details: {
      // Metadata only: never the recipient, subject, or body.
      provider: "resend",
      reason: result.ok ? null : result.reason,
      remainingToday: quota.remaining
    }
  });

  if (!result.ok) {
    const message =
      result.reason === "unauthorized"
        ? "The email provider rejected the server credentials."
        : result.reason === "rate_limited"
          ? "The email provider is rate limiting requests. Try again shortly."
          : result.reason === "rejected"
            ? "The email provider rejected the message. Check the sender address and recipient."
            : result.reason === "timeout"
              ? "The email provider timed out. The message may still be delivered; check before retrying."
              : result.reason === "not_configured"
                ? "Email sending is not configured."
                : "The email could not be sent.";
    return NextResponse.json(
      { error: message, reason: result.reason, configured: result.reason !== "not_configured" },
      { status: SEND_STATUS[result.reason] ?? 502 }
    );
  }

  return NextResponse.json({
    sent: true,
    id: result.id,
    remainingToday: quota.remaining
  });
}

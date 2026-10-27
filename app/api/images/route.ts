import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth";
import { recordAuditEvent } from "../../../lib/audit";
import {
  generateImage,
  imageStatus,
  validateImageRequest
} from "../../../lib/image-provider";
import {
  consumeUserQuota,
  quotaLimits,
  retryAfterSeconds
} from "../../../lib/quota";
import { createRateLimiter, requestKey } from "../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Short-window burst guard. Secondary only: the durable daily allowance in
 * `consumeUserQuota` is the production control and survives restarts and
 * multiple instances.
 */
const limiter = createRateLimiter({ windowMs: 10 * 60_000, max: 5 });

const STATUS_BY_REASON = {
  not_configured: 503,
  timeout: 504,
  rate_limited: 429,
  failed: 502
} as const;

/** Configuration status for the UI. Never reveals the key. */
export async function GET(): Promise<Response> {
  return NextResponse.json(imageStatus());
}

/** POST /api/images  { prompt, size?, quality? } */
export async function POST(request: Request): Promise<Response> {
  // Generation costs money, so it always requires a real account.
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const decision = limiter.check(`${user.id}:${requestKey(request)}`);
  if (decision.limited) {
    return NextResponse.json(
      { error: "Too many image requests. Please slow down." },
      {
        status: 429,
        headers: { "retry-after": String(decision.retryAfterSeconds) }
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = imageStatus();
  if (!status.configured) {
    return NextResponse.json(
      {
        error:
          "Image generation is not configured. Add an OpenAI API key to enable it.",
        configured: false
      },
      { status: 503 }
    );
  }

  const validated = validateImageRequest(
    (body as { prompt?: unknown; size?: unknown; quality?: unknown } | null) ?? {}
  );
  if (!validated.ok) {
    const message =
      validated.reason === "too_long"
        ? "Prompt is too long"
        : validated.reason === "bad_size"
          ? "Unsupported image size"
          : validated.reason === "bad_quality"
            ? "Unsupported image quality"
            : "A prompt of at least 3 characters is required";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Reserve the slot before the call: a provider timeout may still be
  // billed, so the safest accounting is to consume it first. The counter is
  // atomic in the database, so concurrent requests cannot overrun the limit.
  const allowance = await consumeUserQuota(
    "image.daily",
    "day",
    quotaLimits().imageDaily
  );
  if (!allowance.ok) {
    if (allowance.reason === "limited") {
      return NextResponse.json(
        {
          error: `Daily image limit (${allowance.limit}) reached. Try again tomorrow.`,
          resetAt: allowance.resetAt
        },
        {
          status: 429,
          headers: { "retry-after": String(retryAfterSeconds(allowance.resetAt)) }
        }
      );
    }
    return NextResponse.json(
      {
        error:
          "The usage quota store is not available, so image generation is disabled to prevent unbounded spend.",
        reason: "quota_unavailable"
      },
      { status: 503 }
    );
  }

  const result = await generateImage({
    prompt: validated.prompt,
    size: validated.size,
    quality: validated.quality
  });

  if (!result.ok) {
    void recordAuditEvent({
      userId: user.id,
      eventType: "image",
      action: "generate",
      status: "failure",
      toolKey: "image.generate",
      details: {
        reason: result.reason,
        model: status.model,
        size: validated.size,
        quality: validated.quality,
        remainingToday: allowance.remaining
      }
    });

    return NextResponse.json(
      {
        error:
          result.reason === "not_configured"
            ? "Image generation is not configured. Add an OpenAI API key to enable it."
            : result.reason === "timeout"
              ? "The image provider timed out. Try again."
              : result.reason === "rate_limited"
                ? "The image provider is rate limiting requests. Try again shortly."
                : "The image provider could not generate an image.",
        reason: result.reason
      },
      { status: STATUS_BY_REASON[result.reason] ?? 502 }
    );
  }

  // Metadata only: the prompt and the image bytes are not written to the
  // database. The image lives in the client session for this build because
  // no object storage is configured.
  void recordAuditEvent({
    userId: user.id,
    eventType: "image",
    action: "generate",
    status: "success",
    toolKey: "image.generate",
    details: {
      model: result.image.model,
      size: result.image.size,
      quality: result.image.quality,
      createdAt: result.image.createdAt,
      assetRef: "client-session",
      remainingToday: allowance.remaining
    }
  });

  return NextResponse.json({
    image: result.image,
    remainingToday: allowance.remaining
  });
}

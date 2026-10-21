import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth";
import {
  consumeUserQuota,
  quotaLimits,
  retryAfterSeconds
} from "../../../lib/quota";
import { createRateLimiter, requestKey } from "../../../lib/rate-limit";
import {
  MAX_AUDIO_BYTES,
  transcribeAudio,
  transcriptionStatus,
  validateAudio
} from "../../../lib/transcribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ windowMs: 10 * 60_000, max: 10 });

const STATUS_BY_REASON = {
  not_configured: 503,
  empty_transcript: 422,
  timeout: 504,
  no_credit: 402,
  failed: 502
} as const;

const MESSAGE_BY_REASON = {
  unsupported_type: "Unsupported audio type",
  empty: "The recording is empty",
  too_large: "The recording is too large (25 MB maximum)",
  bad_duration: "The recording duration is missing or invalid",
  too_long: "The recording is longer than 5 minutes"
} as const;

/** Configuration and retention status for the UI. */
export async function GET(): Promise<Response> {
  return NextResponse.json(transcriptionStatus());
}

/**
 * POST /api/transcribe  (multipart/form-data)
 *
 * Fields:
 *   audio            required, the recording
 *   durationSeconds  required, reported by the recorder
 *
 * The audio is never written to disk or the database. It exists only as a
 * buffer for this request, so there is no temporary file to delete.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const decision = limiter.check(`${user.id}:${requestKey(request)}`);
  if (decision.limited) {
    return NextResponse.json(
      { error: "Too many transcription requests. Please slow down." },
      {
        status: 429,
        headers: { "retry-after": String(decision.retryAfterSeconds) }
      }
    );
  }

  // Reject an oversized body before parsing it into memory.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + 1_000_000) {
    return NextResponse.json(
      { error: "The recording is too large (25 MB maximum)" },
      { status: 413 }
    );
  }

  const status = transcriptionStatus();
  if (!status.configured) {
    return NextResponse.json(
      {
        error:
          "Voice transcription is not configured. Add an OpenAI API key to enable it.",
        configured: false
      },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "Audio file is required" }, { status: 400 });
  }

  const durationRaw = form.get("durationSeconds");
  const durationSeconds =
    typeof durationRaw === "string" ? Number(durationRaw) : NaN;

  const validated = validateAudio({
    mimeType: audio.type,
    size: audio.size,
    durationSeconds
  });

  if (!validated.ok) {
    return NextResponse.json(
      { error: MESSAGE_BY_REASON[validated.reason], reason: validated.reason },
      {
        status: validated.reason === "too_large" ? 413 : 400
      }
    );
  }

  // Durable daily allowance, separate from the in-process burst guard.
  const quota = await consumeUserQuota(
    "transcribe.daily",
    "day",
    quotaLimits().transcribeDaily
  );
  if (!quota.ok) {
    if (quota.reason === "limited") {
      return NextResponse.json(
        {
          error: `Daily transcription limit (${quota.limit}) reached. Try again tomorrow.`,
          resetAt: quota.resetAt
        },
        {
          status: 429,
          headers: { "retry-after": String(retryAfterSeconds(quota.resetAt)) }
        }
      );
    }
    return NextResponse.json(
      {
        error:
          "The usage quota store is not available, so transcription is disabled to prevent unbounded spend.",
        reason: "quota_unavailable"
      },
      { status: 503 }
    );
  }

  // In-memory only. No temp file, no database row, no object storage.
  const buffer = new Uint8Array(await audio.arrayBuffer());

  const result = await transcribeAudio({
    data: buffer,
    mimeType: validated.mimeType,
    extension: validated.extension
  });

  if (!result.ok) {
    const message =
      result.reason === "not_configured"
        ? "Voice transcription is not configured. Add an OpenAI API key to enable it."
        : result.reason === "timeout"
          ? "Transcription timed out. Try a shorter recording."
          : result.reason === "empty_transcript"
            ? "No speech was detected in that recording."
            : result.reason === "no_credit"
              ? "The OpenAI account has no credit left. Add credit at platform.openai.com/settings/organization/billing/ and try again."
              : "The recording could not be transcribed.";
    return NextResponse.json(
      { error: message, reason: result.reason },
      { status: STATUS_BY_REASON[result.reason] ?? 502 }
    );
  }

  return NextResponse.json({
    text: result.text,
    model: result.model,
    durationSeconds: validated.durationSeconds,
    // Stated explicitly so the UI can describe behaviour accurately.
    retention: "not_stored"
  });
}

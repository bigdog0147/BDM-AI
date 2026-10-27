/**
 * Speech-to-text.
 *
 * Uses the OpenAI transcriptions endpoint through the already-installed SDK,
 * imported lazily so nothing loads unless a recording is actually sent.
 *
 * Verified against current OpenAI docs:
 *   - models: gpt-transcribe (recommended), gpt-4o-transcribe,
 *     gpt-4o-mini-transcribe, whisper-1
 *   - formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
 *   - maximum file size: 25 MB
 *
 * Privacy: audio is held in memory for the duration of the request only.
 * Nothing is written to disk, the database, or object storage, so there is
 * no temporary file to clean up afterwards.
 */

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 300;

const DEFAULT_MODEL = "gpt-transcribe";

/** MIME type -> filename extension. Also acts as the server-side allow-list. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mpga": "mpga",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac"
};

/** Strip MediaRecorder codec parameters: "audio/webm;codecs=opus". */
export function normalizeMimeType(raw: string): string {
  return raw.split(";")[0].trim().toLowerCase();
}

export function extensionForMimeType(mimeType: string): string | null {
  return EXTENSION_BY_MIME[normalizeMimeType(mimeType)] ?? null;
}

export function resolveTranscribeModel(): string {
  return process.env.BDM_TRANSCRIBE_MODEL?.trim() || DEFAULT_MODEL;
}

export function transcriptionStatus(): {
  provider: "openai" | null;
  model: string | null;
  configured: boolean;
  /** Audio is never persisted by this server. */
  retention: "not_stored";
  maxBytes: number;
  maxDurationSeconds: number;
} {
  const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
  return {
    provider: configured ? "openai" : null,
    model: configured ? resolveTranscribeModel() : null,
    configured,
    retention: "not_stored",
    maxBytes: MAX_AUDIO_BYTES,
    maxDurationSeconds: MAX_DURATION_SECONDS
  };
}

export type AudioValidation =
  | { ok: true; mimeType: string; extension: string; durationSeconds: number }
  | {
      ok: false;
      reason:
        | "unsupported_type"
        | "empty"
        | "too_large"
        | "bad_duration"
        | "too_long";
    };

export function validateAudio(input: {
  mimeType?: unknown;
  size?: unknown;
  durationSeconds?: unknown;
}): AudioValidation {
  const mimeType = typeof input.mimeType === "string" ? input.mimeType : "";
  const extension = extensionForMimeType(mimeType);
  if (!extension) return { ok: false, reason: "unsupported_type" };

  const size = typeof input.size === "number" ? input.size : 0;
  if (!Number.isFinite(size) || size <= 0) return { ok: false, reason: "empty" };
  if (size > MAX_AUDIO_BYTES) return { ok: false, reason: "too_large" };

  // Duration is reported by the recorder. It is validated rather than
  // trusted silently; the byte ceiling above is the hard server-side bound.
  const duration =
    typeof input.durationSeconds === "number"
      ? input.durationSeconds
      : Number(input.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { ok: false, reason: "bad_duration" };
  }
  if (duration > MAX_DURATION_SECONDS) return { ok: false, reason: "too_long" };

  return {
    ok: true,
    mimeType: normalizeMimeType(mimeType),
    extension,
    durationSeconds: Math.round(duration * 10) / 10
  };
}

export type TranscriptionFailureReason =
  | "not_configured"
  | "empty_transcript"
  | "timeout"
  | "no_credit"
  | "failed";

export type TranscriptionResult =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: TranscriptionFailureReason; message: string };

export async function transcribeAudio(input: {
  data: Uint8Array;
  mimeType: string;
  extension: string;
}): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "not_configured",
      message: "transcription not configured"
    };
  }

  const model = resolveTranscribeModel();

  try {
    const { default: OpenAI, toFile } = await import("openai");
    const client = new OpenAI({ apiKey, timeout: 120_000, maxRetries: 1 });

    // The SDK uploads this as a multipart file; the buffer stays in memory.
    const file = await toFile(input.data, `recording.${input.extension}`, {
      type: input.mimeType
    });

    const response = await client.audio.transcriptions.create({
      file,
      model
    });

    const text =
      typeof response === "string"
        ? response
        : typeof response.text === "string"
          ? response.text
          : "";

    if (!text.trim()) {
      return {
        ok: false,
        reason: "empty_transcript",
        message: "transcription failed: empty transcript"
      };
    }

    return { ok: true, text: text.trim(), model };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    console.error("BDM transcription error", name, message);

    if (name === "APIConnectionTimeoutError" || /timeout|timed out/i.test(message)) {
      return { ok: false, reason: "timeout", message: "transcription timeout" };
    }
    // An exhausted OpenAI balance arrives as a 429 and is not a rate limit.
    if (/insufficient_quota|no credits remaining|billing/i.test(message)) {
      return { ok: false, reason: "no_credit", message: "transcription out of credit" };
    }
    return { ok: false, reason: "failed", message: "transcription failed" };
  }
}

/**
 * Image generation provider.
 *
 * Uses the OpenAI Images API through the SDK that the app already depends
 * on (`openai` 7.5.0), imported lazily so nothing is loaded unless a
 * generation is actually requested.
 *
 * Verified against the installed SDK types and current OpenAI API docs:
 *   - model: gpt-image-* (gpt-image-1 is the safe default)
 *   - size: 1024x1024 | 1024x1536 | 1536x1024
 *   - quality: low | medium | high
 *   - output_format: png | webp | jpeg
 *   - GPT image models return base64 in `data[0].b64_json`
 *
 * Cost safeguards are enforced here, not in the UI: exactly one image per
 * request, an allow-list of sizes and qualities, and a low-quality default.
 */

export const IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const IMAGE_QUALITIES = ["low", "medium", "high"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export const MIN_PROMPT_LENGTH = 3;
export const MAX_PROMPT_LENGTH = 1000;

const DEFAULT_MODEL = "gpt-image-1";
const TIMEOUT_MS = 120_000;
/** Base64 payload ceiling (~8 MB decoded guard). */
const MAX_BASE64_LENGTH = 11_000_000;

export function resolveImageModel(): string {
  return process.env.BDM_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
}

export function imageStatus(): {
  provider: "openai" | null;
  model: string | null;
  configured: boolean;
} {
  const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
  return {
    provider: configured ? "openai" : null,
    model: configured ? resolveImageModel() : null,
    configured
  };
}

export type ImageValidation =
  | { ok: true; prompt: string; size: ImageSize; quality: ImageQuality }
  | { ok: false; reason: "empty" | "too_short" | "too_long" | "bad_size" | "bad_quality" };

export function validateImageRequest(input: {
  prompt?: unknown;
  size?: unknown;
  quality?: unknown;
}): ImageValidation {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, reason: "empty" };
  if (prompt.length < MIN_PROMPT_LENGTH) return { ok: false, reason: "too_short" };
  if (prompt.length > MAX_PROMPT_LENGTH) return { ok: false, reason: "too_long" };

  const size = (input.size ?? "1024x1024") as ImageSize;
  if (!IMAGE_SIZES.includes(size)) return { ok: false, reason: "bad_size" };

  const quality = (input.quality ?? "low") as ImageQuality;
  if (!IMAGE_QUALITIES.includes(quality)) {
    return { ok: false, reason: "bad_quality" };
  }

  return { ok: true, prompt, size, quality };
}

export type ImageFailureReason =
  | "not_configured"
  | "timeout"
  | "rate_limited"
  | "failed";

export interface GeneratedImage {
  /** data: URL suitable for <img src> and a download link. */
  dataUrl: string;
  mimeType: "image/png";
  size: ImageSize;
  quality: ImageQuality;
  model: string;
  provider: "openai";
  createdAt: string;
}

export type ImageResult =
  | { ok: true; image: GeneratedImage }
  | { ok: false; reason: ImageFailureReason; message: string };

export async function generateImage(input: {
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
}): Promise<ImageResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "not_configured",
      message: "image not configured"
    };
  }

  const model = resolveImageModel();

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      apiKey,
      timeout: TIMEOUT_MS,
      maxRetries: 1
    });

    const response = await client.images.generate({
      model,
      prompt: input.prompt,
      n: 1,
      size: input.size,
      quality: input.quality,
      output_format: "png"
    });

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      return {
        ok: false,
        reason: "failed",
        message: "image failed: provider returned no image data"
      };
    }
    if (base64.length > MAX_BASE64_LENGTH) {
      return {
        ok: false,
        reason: "failed",
        message: "image failed: image too large"
      };
    }

    return {
      ok: true,
      image: {
        dataUrl: `data:image/png;base64,${base64}`,
        mimeType: "image/png",
        size: input.size,
        quality: input.quality,
        model,
        provider: "openai",
        createdAt: new Date().toISOString()
      }
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    console.error("BDM image generation error", name, message);

    if (name === "APIConnectionTimeoutError" || /timeout|timed out/i.test(message)) {
      return { ok: false, reason: "timeout", message: "image timeout" };
    }
    if (name === "RateLimitError" || /\b429\b/.test(message)) {
      return { ok: false, reason: "rate_limited", message: "image rate limited" };
    }
    return { ok: false, reason: "failed", message: "image failed" };
  }
}

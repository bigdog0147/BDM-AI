/**
 * Image generation via OpenRouter.
 * Uses the tool-based image-generation endpoint documented at
 * https://openrouter.ai/docs/guides/image-generation.
 */

export interface ImageGenerateArgs {
  prompt: string;
  model?: string;
  quality?: "low" | "medium" | "high";
  aspectRatio?: string; // e.g. "16:9"
  size?: string; // e.g. "1024x1024"
  background?: "transparent" | "opaque" | "auto";
  outputFormat?: "png" | "jpg" | "webp";
}

export interface ImageGenerateResult {
  ok: true;
  url: string;
  model: string;
  metadata?: { cost?: number; usage?: unknown };
}

export interface ImageGenerateFailure {
  ok: false;
  reason: string;
  message: string;
}

export type ImageResult = ImageGenerateResult | ImageGenerateFailure;

export async function generateImage(args: ImageGenerateArgs): Promise<ImageResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_IMAGE_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "not_configured", message: "OPENROUTER_API_KEY (or OPENROUTER_IMAGE_API_KEY) is not configured" };
  }
  const model = args.model?.trim() || process.env.OPENROUTER_IMAGE_MODEL?.trim() || "openai/gpt-5-image";

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: args.prompt }],
        tools: [
          {
            type: "openrouter:image_generation",
            parameters: {
              model: "openai/gpt-5-image",
              quality: args.quality ?? "high",
              aspect_ratio: args.aspectRatio ?? "16:9",
              size: args.size ?? "1024x1024",
              background: args.background ?? "transparent",
              output_format: args.outputFormat ?? "png"
            }
          }
        ]
      }),
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, reason: "failed", message: `openrouter image error ${response.status}: ${body}` };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { ok: false, reason: "bad_response", message: "openrouter image empty response" };
    }

    // OpenRouter image responses typically return a markdown image URL or a raw URL.
    const urlMatch = content.match(/\]\((https?:\/\/[^\s)]+)\)/) || content.match(/(https?:\/\/[^\s]+)/);
    const url = urlMatch ? urlMatch[1] : content;

    return { ok: true, url, model };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "failed", message: msg };
  }
}

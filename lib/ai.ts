/**
 * AI provider layer.
 *
 * Extracted verbatim from the chat route so research (and any future tool)
 * can reuse the exact same provider behaviour instead of growing a second
 * copy. Behaviour is intentionally unchanged:
 *
 *  - Ollama is the default; the OpenAI SDK is only imported when the
 *    provider is explicitly "openai", so a paid call can never happen by
 *    accident in local mode.
 *  - A hosted Ollama model (":cloud") is only tried when a key exists.
 *  - OLLAMA_FALLBACK_MODEL is optional and only used after a primary failure.
 */

export type Provider = "ollama" | "openai";

export const OLLAMA_TIMEOUT_MS = 240_000;
export const OPENAI_TIMEOUT_MS = 60_000;
export const MAX_OUTPUT_TOKENS = 4096;

export interface GenerateArgs {
  /** System instructions. */
  system: string;
  /** The user turn (may include quoted reference material). */
  user: string;
}

export interface GenerateResult {
  text: string;
  model: string;
  provider: Provider;
}

export function resolveProvider(): Provider {
  const value = process.env.AI_PROVIDER?.trim().toLowerCase();
  // Default to local Ollama so the app never spends on OpenAI by accident.
  if (!value || value === "ollama") return "ollama";
  if (value === "openai") return "openai";
  // An unknown value must not silently fall back to a paid provider.
  throw new Error(`Unknown AI_PROVIDER: ${value}`);
}

export function resolveOllamaModel(): string {
  const model = process.env.OLLAMA_MODEL?.trim();
  if (!model) {
    throw new Error("OLLAMA_MODEL is not configured");
  }
  return model;
}

/**
 * Optional second model, used only when the primary one fails.
 *
 * A hosted model (a name ending in ":cloud") needs a signed-in Ollama
 * account and a network round trip, so it can be unavailable for reasons a
 * local model is not. The fallback keeps the app answering instead of
 * erroring out. It is optional: without it the primary failure surfaces
 * as before.
 */
export function resolveOllamaFallbackModel(): string | null {
  const model = process.env.OLLAMA_FALLBACK_MODEL?.trim();
  return model ? model : null;
}

/**
 * Where the fallback model lives.
 *
 * The fallback is a local model, so it goes to the local server even when
 * the primary model is hosted.
 */
export function resolveOllamaFallbackHost(): string {
  return process.env.OLLAMA_FALLBACK_HOST?.trim() || resolveOllamaHost();
}

export function resolveOllamaHost(): string {
  return process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434";
}

/**
 * The hosted API, used when an API key is available.
 *
 * "https://ollama.com" serves cloud models without any local install. The
 * key is optional here: without one the app stays on the local server.
 */
export function resolveOllamaApiHost(): string | null {
  const host = process.env.OLLAMA_API_HOST?.trim();
  if (host) return host;
  return resolveOllamaApiKey() ? "https://ollama.com" : null;
}

export function resolveOllamaApiKey(): string | null {
  const key = process.env.OLLAMA_API_KEY?.trim();
  return key ? key : null;
}

/** Never send the key to a local server: it only ever goes to Ollama. */
function isLocalHost(host: string): boolean {
  try {
    const hostname = new URL(host).hostname;
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "0.0.0.0"
    );
  } catch {
    return true;
  }
}

function ollamaHeaders(host: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  const key = resolveOllamaApiKey();
  if (key && !isLocalHost(host)) {
    headers.authorization = `Bearer ${key}`;
  }
  return headers;
}

export function resolveOpenAIModel(): string {
  const model = process.env.OPENAI_MODEL?.trim();
  if (!model) {
    throw new Error("OPENAI_MODEL is not configured");
  }
  return model;
}

/**
 * Local Ollama chat via the documented /api/chat endpoint. Called from the
 * server only - never from browser JavaScript. Uses fetch with an
 * AbortController so timeouts are enforced. Returns the assistant text.
 */
async function callOllamaModel(
  system: string,
  user: string,
  model: string,
  host: string
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: ollamaHeaders(host),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      }),
      signal: controller.signal
    });
  } catch (error) {
    // fetch throws on connection refused / abort.
    const aborted = error instanceof Error && error.name === "AbortError";
    if (aborted) {
      throw new Error("ollama timeout");
    }
    throw new Error("ollama unreachable");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // e.g. 404 when the model is not pulled locally.
    if (response.status === 404) {
      throw new Error("ollama model not found");
    }
    // 401/403 come from a hosted model that has no valid key or session.
    if (response.status === 401 || response.status === 403) {
      throw new Error("ollama cloud unavailable");
    }
    throw new Error(`ollama error ${response.status}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("ollama malformed response");
  }

  const text = (data as { message?: { content?: unknown } } | null)?.message
    ?.content;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("ollama empty response");
  }

  return text.trim();
}

/**
 * Call Ollama with the primary model and fall back to the secondary one.
 *
 * The model that actually answered is returned, so the response and the
 * persisted turn record the truth rather than the intention.
 */
export async function callOllama(
  args: GenerateArgs
): Promise<{ text: string; model: string }> {
  const apiHost = resolveOllamaApiHost();
  const fallback = resolveOllamaFallbackModel();

  // The hosted API is only worth trying when there is a key to authorise
  // with; without one the request would be rejected before it started, so
  // the app goes straight to the local server instead of burning a round
  // trip on a call that cannot succeed.
  const canUseApi = Boolean(apiHost) && Boolean(resolveOllamaApiKey());

  // With a key the primary call goes to the hosted API, using the hosted
  // model name when one is given. Without a key it stays on the local
  // server, which needs no credentials at all.
  const primaryHost = canUseApi ? (apiHost as string) : resolveOllamaHost();
  const primaryModel = canUseApi
    ? process.env.OLLAMA_API_MODEL?.trim() || resolveOllamaModel()
    : resolveOllamaModel();

  try {
    const text = await callOllamaModel(
      args.system,
      args.user,
      primaryModel,
      primaryHost
    );
    return { text, model: primaryModel };
  } catch (primaryError) {
    if (!fallback) {
      throw primaryError;
    }

    try {
      const text = await callOllamaModel(
        args.system,
        args.user,
        fallback,
        resolveOllamaFallbackHost()
      );
      return { text, model: fallback };
    } catch (fallbackError) {
      // The primary failure is the more useful one to report: it names the
      // real reason (no key, plan limit, unknown model).
      console.error("BDM ollama fallback failed", fallbackError);
      throw primaryError;
    }
  }
}

/**
 * OpenAI Responses API. The SDK is imported lazily so that in the default
 * Ollama mode the OpenAI module is never loaded and can never make a paid
 * request, even if a key is present in the environment.
 */
export async function callOpenAI(
  args: GenerateArgs
): Promise<{ text: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = resolveOpenAIModel();

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: 2
  });

  const response = await client.responses.create({
    model,
    instructions: args.system,
    input: args.user,
    max_output_tokens: MAX_OUTPUT_TOKENS
  });

  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("openai empty response");
  }
  return { text, model };
}

/** Single entry point used by chat, research, and any tool that needs text. */
export async function generateReply(
  args: GenerateArgs
): Promise<GenerateResult> {
  const provider = resolveProvider();

  if (provider === "ollama") {
    const result = await callOllama(args);
    return { ...result, provider };
  }

  const result = await callOpenAI(args);
  return { ...result, provider };
}

/**
 * Redacted provider status for the UI. Never includes key values, and never
 * loads the OpenAI SDK.
 */
export function aiStatus(): {
  provider: Provider;
  model: string | null;
  configured: boolean;
} {
  let provider: Provider = "ollama";
  try {
    provider = resolveProvider();
  } catch {
    return { provider: "ollama", model: null, configured: false };
  }

  if (provider === "openai") {
    const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim());
    return {
      provider,
      model: process.env.OPENAI_MODEL?.trim() || null,
      configured: hasKey
    };
  }

  const apiKey = resolveOllamaApiKey();
  return {
    provider,
    model:
      process.env.OLLAMA_API_MODEL?.trim() ||
      process.env.OLLAMA_MODEL?.trim() ||
      null,
    // Local Ollama needs no key; report configured when a model is named.
    configured: Boolean(process.env.OLLAMA_MODEL?.trim()) || Boolean(apiKey)
  };
}

import { SYSTEM_PROMPT } from "../../../lib/prompt";
import { persistTurn } from "../../../lib/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 20000;
// Local CPU inference of a multi-billion-parameter model can be slow on a
// cold load, so the Ollama timeout is generous. The OpenAI path keeps its
// own shorter timeout below.
const OLLAMA_TIMEOUT_MS = 240_000;
const OPENAI_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 4096;

/** Default provider. Local Ollama is used unless explicitly overridden. */
export type Provider = "ollama" | "openai";

function resolveProvider(): Provider {
  const value = process.env.AI_PROVIDER?.trim().toLowerCase();
  // Default to local Ollama so the app never spends on OpenAI by accident.
  if (!value || value === "ollama") return "ollama";
  if (value === "openai") return "openai";
  // An unknown value must not silently fall back to a paid provider.
  throw new Error(`Unknown AI_PROVIDER: ${value}`);
}

function resolveOllamaModel(): string {
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
function resolveOllamaFallbackModel(): string | null {
  const model = process.env.OLLAMA_FALLBACK_MODEL?.trim();
  return model ? model : null;
}

/**
 * Where the fallback model lives.
 *
 * The fallback is a local model, so it goes to the local server even when
 * the primary model is hosted.
 */
function resolveOllamaFallbackHost(): string {
  return (
    process.env.OLLAMA_FALLBACK_HOST?.trim() || resolveOllamaHost()
  );
}

function resolveOllamaHost(): string {
  return (
    process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434"
  );
}

/**
 * The hosted API, used when an API key is available.
 *
 * "https://ollama.com" serves cloud models without any local install. The
 * key is optional here: without one the app stays on the local server.
 */
function resolveOllamaApiHost(): string | null {
  const host = process.env.OLLAMA_API_HOST?.trim();
  if (host) return host;
  return resolveOllamaApiKey() ? "https://ollama.com" : null;
}

function resolveOllamaApiKey(): string | null {
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

function resolveOpenAIModel(): string {
  const model = process.env.OPENAI_MODEL?.trim();
  if (!model) {
    throw new Error("OPENAI_MODEL is not configured");
  }
  return model;
}

/**
 * Local Ollama chat via the documented /api/chat endpoint. Called from the
 * server route only - never from browser JavaScript. Uses fetch with an
 * AbortController so timeouts are enforced. Returns the assistant text.
 *
 * `model` is passed in so the same call can serve the primary model and the
 * fallback model.
 */
async function callOllamaModel(
  message: string,
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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message }
        ]
      }),
      signal: controller.signal
    });
  } catch (error) {
    // fetch throws on connection refused / abort.
    const aborted =
      error instanceof Error && error.name === "AbortError";
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

  const text = (data as { message?: { content?: unknown } } | null)
    ?.message?.content;

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
async function callOllama(
  message: string
): Promise<{ text: string; model: string }> {
  const apiHost = resolveOllamaApiHost();
  const fallback = resolveOllamaFallbackModel();

  // With a key the primary call goes to the hosted API, using the hosted
  // model name when one is given. Without a key it stays on the local
  // server, which needs no credentials at all.
  const primaryHost = apiHost || resolveOllamaHost();
  const primaryModel = apiHost
    ? process.env.OLLAMA_API_MODEL?.trim() || resolveOllamaModel()
    : resolveOllamaModel();

  try {
    const text = await callOllamaModel(message, primaryModel, primaryHost);
    return { text, model: primaryModel };
  } catch (primaryError) {
    if (!fallback) {
      throw primaryError;
    }

    try {
      const text = await callOllamaModel(
        message,
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
async function callOpenAI(message: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: 2
  });

  const response = await client.responses.create({
    model: resolveOpenAIModel(),
    instructions: SYSTEM_PROMPT,
    input: message,
    max_output_tokens: MAX_OUTPUT_TOKENS
  });

  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("openai empty response");
  }
  return text;
}

/**
 * Simple in-process sliding-window rate limiter. This is a single-instance
 * guard, not a distributed one; a shared store is needed for multi-instance
 * deployments. Per-instance limits are still better than none.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

/** Never leak internals to the browser. */
function safeError(message: string): string {
  if (message.includes("OPENAI_API_KEY")) return "AI provider is not configured";
  if (message.includes("OPENAI_MODEL")) return "AI model is not configured";
  if (message.includes("OLLAMA_MODEL")) return "Local model is not configured";
  if (message.includes("Unknown AI_PROVIDER")) return "AI provider is misconfigured";
  if (message.includes("ollama unreachable")) {
    return "The local assistant (Ollama) is not running. Start Ollama and try again.";
  }
  if (message.includes("ollama model not found")) {
    return "The configured local model is not installed. Pull it in Ollama and try again.";
  }
  if (message.includes("ollama cloud unavailable")) {
    return "The hosted model is unavailable. Check the Ollama API key, or sign in with 'ollama signin', and try again.";
  }
  if (message.includes("ollama timeout")) {
    return "The local assistant timed out. Please try again.";
  }
  if (message.includes("ollama malformed") || message.includes("ollama empty")) {
    return "The local assistant returned an unexpected response.";
  }
  if (message.includes("ollama error")) {
    return "The local assistant reported an error. Please try again.";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "The assistant timed out. Please try again.";
  }
  if (message.includes("rate limit") || message.includes("429")) {
    return "The assistant is busy. Please try again shortly.";
  }
  return "The assistant could not complete the request.";
}

export async function POST(request: Request): Promise<Response> {
  try {
    const identifier =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

    if (rateLimited(identifier)) {
      return Response.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "retry-after": "60" } }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const raw = (body as { message?: unknown } | null)?.message;
    if (typeof raw !== "string") {
      return Response.json({ error: "message is required" }, { status: 400 });
    }

    const message = raw.trim();
    if (!message) {
      return Response.json({ error: "message is required" }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return Response.json({ error: "message is too long" }, { status: 413 });
    }

    // Optional conversation to continue. Ignored (never trusted for auth);
    // RLS on the server decides whether the caller may write to it.
    const rawConversationId = (body as { conversationId?: unknown } | null)
      ?.conversationId;
    const conversationId =
      typeof rawConversationId === "string" && rawConversationId.trim()
        ? rawConversationId.trim()
        : null;

    // Resolve the provider BEFORE doing any work. In ollama mode the OpenAI
    // SDK is never imported and no paid call can occur.
    const provider = resolveProvider();

    let text: string;
    let model: string;

    if (provider === "ollama") {
      const result = await callOllama(message);
      model = result.model;
      text = result.text;
    } else {
      model = resolveOpenAIModel();
      text = await callOpenAI(message);
    }

    // Persist the turn only after a successful generation. This is
    // best-effort: it never throws into the response path, and anonymous or
    // unconfigured use simply isn't saved.
    const savedConversationId = await persistTurn({
      userMessage: message,
      assistantText: text,
      model,
      conversationId
    });

    return Response.json({
      id: `${provider}-${Date.now()}`,
      provider,
      model,
      text,
      conversationId: savedConversationId
    });
  } catch (error) {
    // Log detail server-side only; never return it to the browser.
    console.error("BDM chat error", error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: safeError(message) }, { status: 500 });
  }
}

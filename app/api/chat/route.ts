import { SYSTEM_PROMPT } from "../../../lib/prompt";

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

function resolveOllamaHost(): string {
  return (
    process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434"
  );
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
 */
async function callOllama(message: string): Promise<string> {
  const host = resolveOllamaHost();
  const model = resolveOllamaModel();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

    // Resolve the provider BEFORE doing any work. In ollama mode the OpenAI
    // SDK is never imported and no paid call can occur.
    const provider = resolveProvider();

    let text: string;
    let model: string;

    if (provider === "ollama") {
      model = resolveOllamaModel();
      text = await callOllama(message);
    } else {
      model = resolveOpenAIModel();
      text = await callOpenAI(message);
    }

    return Response.json({
      id: `${provider}-${Date.now()}`,
      provider,
      model,
      text
    });
  } catch (error) {
    // Log detail server-side only; never return it to the browser.
    console.error("BDM chat error", error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: safeError(message) }, { status: 500 });
  }
}

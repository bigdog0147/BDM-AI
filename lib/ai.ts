/**
 * AI provider layer.
 *
 * Two server-side providers, selected by AI_PROVIDER:
 *   - openai: OPENAI_API_KEY + OPENAI_MODEL
 *   - ollama: Ollama Cloud (OLLAMA_API_KEY + OLLAMA_API_MODEL, endpoint
 *     https://ollama.com) or a local server (OLLAMA_MODEL + OLLAMA_HOST).
 *
 * An optional, explicitly configured secondary provider
 * (AI_FALLBACK_PROVIDER=none|openai|ollama) is tried once when the primary
 * fails for a transient reason (timeout, network, 429, 5xx). Authentication,
 * configuration, and malformed-response errors never trigger a fallback, so a
 * bad key is reported instead of silently masked by another provider.
 *
 * The OpenAI SDK is imported lazily, so an Ollama deployment never loads it
 * and cannot accidentally spend money.
 */

export type Provider = "openai" | "ollama";

export type FailureKind =
  | "config"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "unreachable"
  | "server"
  | "bad_response";

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
  /** Set only when the answering provider is the configured fallback. */
  fallbackFrom?: Provider;
}

/** A configuration problem, safe to map directly to an actionable message. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

/** A classified provider failure. Messages never contain credentials. */
export class ProviderError extends Error {
  readonly provider: Provider;
  readonly kind: FailureKind;

  constructor(provider: Provider, kind: FailureKind, message: string) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
  }
}

/**
 * Only a transient failure may be retried on the secondary provider.
 * Auth/config errors must surface, and a malformed response must not be
 * papered over by silently asking a different vendor.
 */
export function isFallbackEligible(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    (error.kind === "timeout" ||
      error.kind === "unreachable" ||
      error.kind === "rate_limit" ||
      error.kind === "server")
  );
}

export function resolveProvider(): Provider {
  const value = process.env.AI_PROVIDER?.trim().toLowerCase();
  // Default to Ollama so an unconfigured deployment never spends on OpenAI.
  if (!value || value === "ollama") return "ollama";
  if (value === "openai") return "openai";
  throw new ProviderConfigError(`Unknown AI_PROVIDER: ${value}`);
}

/** Explicit secondary provider, or null. Never inferred. */
export function resolveFallbackProvider(primary: Provider): Provider | null {
  const raw = process.env.AI_FALLBACK_PROVIDER?.trim().toLowerCase();
  if (!raw || raw === "none" || raw === "off") return null;
  if (raw !== "openai" && raw !== "ollama") {
    throw new ProviderConfigError(`Unknown AI_FALLBACK_PROVIDER: ${raw}`);
  }
  if (raw === primary) {
    throw new ProviderConfigError(
      "AI_FALLBACK_PROVIDER must differ from AI_PROVIDER"
    );
  }
  return raw;
}

/** Render sets RENDER=true; a local Ollama server is not reachable from it. */
function isRender(): boolean {
  return (
    process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID)
  );
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

function normalizeHost(host: string): string {
  return host.replace(/\/+$/, "");
}

export function resolveOllamaHost(): string {
  return process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434";
}

export function resolveOllamaApiHost(): string | null {
  const host = process.env.OLLAMA_API_HOST?.trim();
  if (host) return host;
  return resolveOllamaApiKey() ? "https://ollama.com" : null;
}

export function resolveOllamaApiKey(): string | null {
  const key = process.env.OLLAMA_API_KEY?.trim();
  return key ? key : null;
}

export function resolveOllamaModel(): string {
  const model = process.env.OLLAMA_MODEL?.trim();
  if (!model) {
    throw new ProviderConfigError("OLLAMA_MODEL is not configured");
  }
  return model;
}

export function resolveOllamaFallbackModel(): string | null {
  const model = process.env.OLLAMA_FALLBACK_MODEL?.trim();
  return model ? model : null;
}

export function resolveOllamaFallbackHost(): string {
  return process.env.OLLAMA_FALLBACK_HOST?.trim() || resolveOllamaHost();
}

export function resolveOpenAIModel(): string {
  const model = process.env.OPENAI_MODEL?.trim();
  if (!model) {
    throw new ProviderConfigError("OPENAI_MODEL is not configured");
  }
  return model;
}

export interface OpenAITarget {
  apiKey: string;
  model: string;
}

export function resolveOpenAITarget(): OpenAITarget {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ProviderConfigError("OPENAI_API_KEY is not configured");
  }
  return { apiKey, model: resolveOpenAIModel() };
}

function assertCloudEndpoint(host: string): void {
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    throw new ProviderConfigError("OLLAMA_API_HOST is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new ProviderConfigError("OLLAMA_API_HOST must use https");
  }
  if (isLocalHost(host)) {
    throw new ProviderConfigError(
      "OLLAMA_API_HOST must not point at localhost"
    );
  }
}

export interface OllamaTarget {
  mode: "cloud" | "local";
  host: string;
  model: string;
  apiKey: string | null;
}

/**
 * Resolve exactly one Ollama target.
 *
 * A key means Ollama Cloud and requires OLLAMA_API_MODEL, per the cloud API
 * contract. Without a key the local server is used, and on Render a loopback
 * host is rejected up front with an actionable message instead of a timeout.
 */
export function resolveOllamaTarget(): OllamaTarget {
  const apiKey = resolveOllamaApiKey();
  if (apiKey) {
    const model = process.env.OLLAMA_API_MODEL?.trim();
    if (!model) {
      throw new ProviderConfigError("OLLAMA_API_MODEL is not configured");
    }
    const host = normalizeHost(resolveOllamaApiHost() ?? "https://ollama.com");
    assertCloudEndpoint(host);
    return { mode: "cloud", host, model, apiKey };
  }

  const model = resolveOllamaModel();
  const host = normalizeHost(resolveOllamaHost());
  if (isRender() && isLocalHost(host)) {
    throw new ProviderConfigError(
      "OLLAMA_HOST points at localhost, which is not reachable from Render"
    );
  }
  return { mode: "local", host, model, apiKey: null };
}

export function assertProviderConfigured(provider: Provider): void {
  if (provider === "openai") {
    resolveOpenAITarget();
  } else {
    resolveOllamaTarget();
  }
}

function ollamaHeaders(
  host: string,
  apiKey: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (apiKey && !isLocalHost(host)) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/** Low-level Ollama call. Never includes the key in an error message. */
async function requestOllama(
  args: GenerateArgs,
  model: string,
  host: string,
  apiKey: string | null
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${normalizeHost(host)}/api/chat`, {
      method: "POST",
      headers: ollamaHeaders(host, apiKey),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user }
        ]
      }),
      signal: controller.signal
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ProviderError(
      "ollama",
      aborted ? "timeout" : "unreachable",
      aborted ? "ollama timeout" : "ollama unreachable"
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      // Authentication/authorization: never retried on another model.
      throw new ProviderError("ollama", "auth", "ollama cloud unavailable");
    }
    if (response.status === 404) {
      throw new ProviderError("ollama", "config", "ollama model not found");
    }
    if (response.status === 429) {
      throw new ProviderError("ollama", "rate_limit", "ollama rate limited");
    }
    if (response.status >= 500) {
      throw new ProviderError(
        "ollama",
        "server",
        `ollama error ${response.status}`
      );
    }
    throw new ProviderError(
      "ollama",
      "bad_response",
      `ollama error ${response.status}`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ProviderError(
      "ollama",
      "bad_response",
      "ollama malformed response"
    );
  }

  const text = (data as { message?: { content?: unknown } } | null)?.message
    ?.content;

  if (typeof text !== "string" || !text.trim()) {
    throw new ProviderError("ollama", "bad_response", "ollama empty response");
  }

  return text.trim();
}

/**
 * Call Ollama with an optional same-provider model fallback.
 *
 * The model fallback is only for transient failures. A 401/403 no longer
 * retries locally: a credential problem must be visible, not hidden behind a
 * different model. The provider-level fallback (if configured) runs after
 * this one is exhausted.
 */
export async function callOllama(
  args: GenerateArgs
): Promise<{ text: string; model: string }> {
  const target = resolveOllamaTarget();

  try {
    const text = await requestOllama(
      args,
      target.model,
      target.host,
      target.apiKey
    );
    return { text, model: target.model };
  } catch (error) {
    const primary =
      error instanceof ProviderError
        ? error
        : new ProviderError("ollama", "bad_response", "ollama failed");
    if (!isFallbackEligible(primary)) throw primary;

    const fallbackModel = resolveOllamaFallbackModel();
    if (!fallbackModel) throw primary;

    const fallbackHost = resolveOllamaFallbackHost();
    if (isRender() && isLocalHost(fallbackHost)) {
      console.error(
        "BDM ollama fallback skipped: localhost is not reachable from Render"
      );
      throw primary;
    }

    try {
      const text = await requestOllama(args, fallbackModel, fallbackHost, null);
      return { text, model: fallbackModel };
    } catch (fallbackError) {
      console.error(
        "BDM ollama fallback failed",
        fallbackError instanceof ProviderError ? fallbackError.kind : "unknown"
      );
      throw primary;
    }
  }
}

function statusOf(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

/** Classify SDK errors without importing the SDK's error classes. */
function classifyOpenAIError(error: unknown): ProviderError {
  const status = statusOf(error);
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";

  if (name === "APIConnectionTimeoutError" || /timed out|timeout/i.test(message)) {
    return new ProviderError("openai", "timeout", "openai timeout");
  }
  if (
    name === "APIConnectionError" ||
    /connection error|fetch failed|ECONNREFUSED/i.test(message)
  ) {
    return new ProviderError("openai", "unreachable", "openai unreachable");
  }
  if (status === 401 || status === 403) {
    return new ProviderError("openai", "auth", "openai unauthorized");
  }
  if (status === 429) {
    return new ProviderError("openai", "rate_limit", "openai rate limited");
  }
  if (status !== null && status >= 500) {
    return new ProviderError("openai", "server", `openai error ${status}`);
  }
  if (status !== null && status >= 400) {
    return new ProviderError(
      "openai",
      "bad_response",
      `openai error ${status}`
    );
  }
  return new ProviderError("openai", "bad_response", "openai failed");
}

/**
 * OpenAI Responses API. Imported lazily so an Ollama deployment never loads
 * the SDK. The upstream message is never surfaced: it can contain request
 * details, and the classified error is all a caller needs.
 */
export async function callOpenAI(
  args: GenerateArgs
): Promise<{ text: string; model: string }> {
  const { apiKey, model } = resolveOpenAITarget();

  try {
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
      throw new ProviderError(
        "openai",
        "bad_response",
        "openai empty response"
      );
    }
    return { text, model };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw classifyOpenAIError(error);
  }
}

function toProviderError(provider: Provider, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof ProviderConfigError) {
    return new ProviderError(provider, "config", error.message);
  }
  // Unknown failures are deliberately summarized: the original message may
  // contain upstream request details or credentials.
  return new ProviderError(provider, "bad_response", `${provider} request failed`);
}

/**
 * Single entry point used by chat, research, and email drafting.
 *
 * The fallback is attempted once, before any text has been returned to the
 * caller. Chat is a single JSON response (not a stream), so there is no
 * partially-delivered answer that could switch providers mid-flight.
 */
export async function generateReply(
  args: GenerateArgs
): Promise<GenerateResult> {
  let primary: Provider;
  try {
    primary = resolveProvider();
  } catch (error) {
    throw toProviderError("ollama", error);
  }

  try {
    assertProviderConfigured(primary);
  } catch (error) {
    throw toProviderError(primary, error);
  }

  let fallback: Provider | null = null;
  try {
    fallback = resolveFallbackProvider(primary);
  } catch (error) {
    throw toProviderError(primary, error);
  }

  try {
    const result =
      primary === "openai" ? await callOpenAI(args) : await callOllama(args);
    return { ...result, provider: primary };
  } catch (error) {
    const primaryError = toProviderError(primary, error);
    if (!fallback || !isFallbackEligible(primaryError)) throw primaryError;

    console.error("BDM AI primary failed; trying fallback", primary, primaryError.kind);

    let fallbackResult: { text: string; model: string };
    try {
      assertProviderConfigured(fallback);
      fallbackResult =
        fallback === "openai" ? await callOpenAI(args) : await callOllama(args);
    } catch (fallbackError) {
      const secondary = toProviderError(fallback, fallbackError);
      console.error("BDM AI fallback failed", fallback, secondary.kind);
      // The primary failure is the more actionable one; never expose the
      // secondary error (which could be a misconfigured fallback).
      throw primaryError;
    }

    return {
      ...fallbackResult,
      provider: fallback,
      fallbackFrom: primary
    };
  }
}

function ollamaReadiness(): {
  configured: boolean;
  model: string | null;
  mode: "cloud" | "local" | "none";
} {
  if (resolveOllamaApiKey()) {
    const model = process.env.OLLAMA_API_MODEL?.trim() || null;
    if (!model) return { configured: false, model: null, mode: "cloud" };
    try {
      assertCloudEndpoint(resolveOllamaApiHost() ?? "https://ollama.com");
    } catch {
      return { configured: false, model, mode: "cloud" };
    }
    return { configured: true, model, mode: "cloud" };
  }

  const model = process.env.OLLAMA_MODEL?.trim() || null;
  if (!model) return { configured: false, model: null, mode: "none" };
  if (isRender() && isLocalHost(resolveOllamaHost())) {
    return { configured: false, model, mode: "local" };
  }
  return { configured: true, model, mode: "local" };
}

function providerReady(provider: Provider): boolean {
  if (provider === "openai") {
    return Boolean(
      process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim()
    );
  }
  return ollamaReadiness().configured;
}

export interface AIStatus {
  provider: Provider;
  model: string | null;
  configured: boolean;
  fallback: { provider: Provider | null; configured: boolean };
}

/**
 * Redacted provider status. Never throws: an invalid or incomplete
 * configuration is reported as `configured: false` rather than breaking the
 * status endpoint.
 */
export function aiStatus(): AIStatus {
  let provider: Provider = "ollama";
  try {
    provider = resolveProvider();
  } catch {
    return {
      provider: "ollama",
      model: null,
      configured: false,
      fallback: { provider: null, configured: false }
    };
  }

  let model: string | null;
  let configured: boolean;
  if (provider === "openai") {
    model = process.env.OPENAI_MODEL?.trim() || null;
    configured = providerReady("openai");
  } else {
    const readiness = ollamaReadiness();
    model = readiness.model;
    configured = readiness.configured;
  }

  let fallbackProvider: Provider | null = null;
  try {
    fallbackProvider = resolveFallbackProvider(provider);
  } catch {
    fallbackProvider = null;
  }

  return {
    provider,
    model,
    configured,
    fallback: {
      provider: fallbackProvider,
      configured: fallbackProvider ? providerReady(fallbackProvider) : false
    }
  };
}

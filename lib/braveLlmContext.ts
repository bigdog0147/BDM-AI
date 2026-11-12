/**
 * Separate Brave LLM Context adapter (design-only / local implementation).
 * GET https://api.search.brave.com/res/v1/llm/context
 *
 * Routing guard / local-first: this adapter uses Brave Search independently of
 * the BDM-AI model provider (ollama:qwen3.5:4b local, freellmapi/auto gateway).
 * It never routes to paid/cloud providers; only to the configured Brave endpoint.
 * Never exposes the subscription token; never sends conversation history,
 * memory, private files, or unrelated user data. Only validated query +
 * explicitly allowed options.
 */

import type { SearchSource } from "./search";

export const LLM_CONTEXT_PROVIDER = "brave-llm-context" as const;
export type LLMContextProvider = typeof LLM_CONTEXT_PROVIDER;

export interface LLMContextOptions {
  country?: string;
  search_lang?: string;
  count?: number;
  safesearch?: "off" | "moderate" | "strict";
  spellcheck?: boolean;
  maximum_number_of_urls?: number;
  maximum_number_of_tokens?: number;
  maximum_number_of_snippets?: number;
  context_threshold_mode?: "disabled" | "strict" | "lenient" | "balanced";
  maximum_number_of_tokens_per_url?: number;
  maximum_number_of_snippets_per_url?: number;
  freshness?: string;
  enable_source_metadata?: boolean;
}

export interface LLMContextSuccess {
  ok: true;
  provider: LLMContextProvider;
  sources: SearchSource[];
  tookMs: number;
  contextTokenEstimate?: number;
}

export interface LLMContextFailure {
  ok: false;
  code: string;
  message: string;
  tookMs: number;
}

export type LLMContextResult = LLMContextSuccess | LLMContextFailure;

// Hard caps (design choice; enforced regardless of caller request)
const MAX_QUERY_CHARS = 600;
const MAX_QUERY_WORDS = 75;
const DEFAULT_MAX_URLS = 5;
const HARD_MAX_URLS = 50;
const DEFAULT_MAX_SNIPPETS = 20;
const HARD_MAX_SNIPPETS = 256;
const DEFAULT_MAX_TOKENS = 8192;
const HARD_MAX_TOKENS = 32768;
const DEFAULT_MAX_TOKENS_PER_URL = 2048;
const HARD_MAX_TOKENS_PER_URL = 8192;
const MAX_BODY_BYTES = 256 * 1024;
const TIMEOUT_MS = 15_000;

const SUPPORTED_COUNTRIES = new Set([
  "AR","AU","AT","BE","BR","CA","CL","DK","FI","FR","DE","GR","HK","IN","ID","IT","JP","KR","MY","MX","NL","NZ","NO","CN","PL","PT","PH","RU","SA","ZA","ES","SE","CH","TW","TR","GB","US","ALL"
]);

const SUPPORTED_LANGS = new Set([
  "ar","eu","bn","bg","ca","zh-hans","zh-hant","hr","cs","da","nl","en","en-gb","et","fi","fr","gl","de","el","gu","he","hi","hu","is","it","ja","jp","kn","ko","lv","lt","ls","ml","mr","nb","pl","pt-br","pt-pt","pa","ro","ru","sr","sk","sl","es","sv","ta","te","th","tr","uk","vi"
]);

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function isSafeUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false; // reject embedded credentials
    return true;
  } catch {
    return false;
  }
}

function sanitizeSnippet(text: string): string {
  // Treat as untrusted: truncate, normalize whitespace, do not execute.
  return text.slice(0, 1200).replace(/\s+/g, " ").trim();
}

function sanitizeTitle(text: string): string {
  return text.slice(0, 300).replace(/\s+/g, " ").trim();
}

function buildEndpoint(): string {
  return "https://api.search.brave.com/res/v1/llm/context";
}

export async function searchLLMContext(
  query: string,
  options?: LLMContextOptions
): Promise<LLMContextResult> {
  const start = Date.now();

  // Configuration check (only name checked; never value printed)
  const token = process.env.BRAVE_LLM_CONTEXT_SUBSCRIPTION_TOKEN;
  if (!token || !String(token).trim()) {
    return {
      ok: false,
      code: "LLMContextNotConfigured",
      message: "Brave LLM Context adapter not configured (missing BRAVE_LLM_CONTEXT_SUBSCRIPTION_TOKEN).",
      tookMs: Date.now() - start,
    };
  }

  // Query validation
  const trimmed = String(query ?? "").trim();
  if (trimmed.length === 0) {
    return { ok: false, code: "LLMContextInvalidQuery", message: "Query is empty.", tookMs: Date.now() - start };
  }
  if (trimmed.length > MAX_QUERY_CHARS) {
    return { ok: false, code: "LLMContextInvalidQuery", message: `Query exceeds ${MAX_QUERY_CHARS} characters.`, tookMs: Date.now() - start };
  }
  if (wordCount(trimmed) > MAX_QUERY_WORDS) {
    return { ok: false, code: "LLMContextInvalidQuery", message: `Query exceeds ${MAX_QUERY_WORDS} words.`, tookMs: Date.now() - start };
  }

  // Build params with safe defaults / hard caps
  const params = new URLSearchParams();
  params.set("q", trimmed);

  if (options?.country !== undefined) {
    const c = String(options.country).trim().toUpperCase();
    if (SUPPORTED_COUNTRIES.has(c)) params.set("country", c);
  }
  if (options?.search_lang !== undefined) {
    const l = String(options.search_lang).trim().toLowerCase();
    if (SUPPORTED_LANGS.has(l)) params.set("search_lang", l);
  }

  const count = Math.min(Math.max(1, Number(options?.count) || 20), 50);
  params.set("count", String(count));

  const safesearch = String(options?.safesearch ?? "moderate").trim().toLowerCase();
  if (["off", "moderate", "strict"].includes(safesearch)) params.set("safesearch", safesearch);

  const spellcheck = options?.spellcheck === false ? false : true;
  params.set("spellcheck", String(spellcheck));

  const maxUrls = Math.min(Math.max(1, Number(options?.maximum_number_of_urls) || DEFAULT_MAX_URLS), HARD_MAX_URLS);
  params.set("maximum_number_of_urls", String(maxUrls));

  const maxSnippets = Math.min(Math.max(1, Number(options?.maximum_number_of_snippets) || DEFAULT_MAX_SNIPPETS), HARD_MAX_SNIPPETS);
  params.set("maximum_number_of_snippets", String(maxSnippets));

  const maxTokens = Math.min(Math.max(1024, Number(options?.maximum_number_of_tokens) || DEFAULT_MAX_TOKENS), HARD_MAX_TOKENS);
  params.set("maximum_number_of_tokens", String(maxTokens));

  const maxTokensPerUrl = Math.min(Math.max(512, Number(options?.maximum_number_of_tokens_per_url) || DEFAULT_MAX_TOKENS_PER_URL), HARD_MAX_TOKENS_PER_URL);
  params.set("maximum_number_of_tokens_per_url", String(maxTokensPerUrl));

  const maxSnippetsPerUrl = Math.min(Math.max(1, Number(options?.maximum_number_of_snippets_per_url) || 50), 100);
  params.set("maximum_number_of_snippets_per_url", String(maxSnippetsPerUrl));

  if (options?.context_threshold_mode !== undefined) {
    const m = String(options.context_threshold_mode).trim().toLowerCase();
    if (["disabled", "strict", "lenient", "balanced"].includes(m)) params.set("context_threshold_mode", m);
  }

  if (options?.freshness !== undefined) {
    const f = String(options.freshness).trim();
    // Allow only documented formats; reject arbitrary strings silently (omit param)
    if (/^(pd|pw|pm|py|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$/.test(f)) params.set("freshness", f);
  }

  if (options?.enable_source_metadata === true) params.set("enable_source_metadata", "true");

  const endpoint = buildEndpoint() + "?" + params.toString();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": token,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      return { ok: false, code: "LLMContextUnauthorized", message: "Brave LLM Context authentication failed.", tookMs: Date.now() - start };
    }
    if (response.status === 403) {
      return { ok: false, code: "LLMContextForbidden", message: "Brave LLM Context access forbidden.", tookMs: Date.now() - start };
    }
    if (response.status === 429) {
      return { ok: false, code: "LLMContextRateLimited", message: "Brave LLM Context rate limited.", tookMs: Date.now() - start };
    }
    if (response.status >= 500) {
      return { ok: false, code: "LLMContextFailed", message: "Brave LLM Context server error.", tookMs: Date.now() - start };
    }
    if (!response.ok) {
      return { ok: false, code: "LLMContextFailed", message: `Brave LLM Context returned HTTP ${response.status}.`, tookMs: Date.now() - start };
    }

    // Response size cap before parsing
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
        return { ok: false, code: "LLMContextResponseTooLarge", message: "Response exceeds maximum allowed size.", tookMs: Date.now() - start };
      }
    }

    const rawText = await response.text();
    if (Buffer.byteLength(rawText, "utf8") > MAX_BODY_BYTES) {
      return { ok: false, code: "LLMContextResponseTooLarge", message: "Response exceeds maximum allowed size.", tookMs: Date.now() - start };
    }

    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { ok: false, code: "LLMContextMalformed", message: "Brave LLM Context returned invalid JSON.", tookMs: Date.now() - start };
    }

    if (!data || typeof data !== "object") {
      return { ok: false, code: "LLMContextMalformed", message: "Invalid response structure.", tookMs: Date.now() - start };
    }

    const d = data as { grounding?: unknown; sources?: unknown };
    const sources: SearchSource[] = [];
    let index = 1;

    const generic = d.grounding && typeof d.grounding === "object" ? (d.grounding as { generic?: unknown }).generic : undefined;
    if (Array.isArray(generic)) {
      for (const item of generic) {
        if (!item || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        const urlStr = typeof it.url === "string" ? it.url.trim() : "";
        const titleStr = typeof it.title === "string" ? it.title.trim() : "";
        if (!urlStr || !isSafeUrl(urlStr)) continue; // drop invalid / unsafe URLs
        const snippetStr = Array.isArray(it.snippets)
          ? it.snippets.map((s) => (typeof s === "string" ? sanitizeSnippet(s) : "")).filter((s) => s.length > 0).join(" ")
          : (typeof it.snippet === "string" ? sanitizeSnippet(it.snippet) : "");
        // Hard cap on snippets included per source (approximate via snippet length/truncation already applied)
        sources.push({
          index: index++,
          title: sanitizeTitle(titleStr) || "Untitled",
          url: urlStr,
          snippet: snippetStr.slice(0, 1200),
          domain: (() => {
            try {
              return new URL(urlStr).hostname.replace(/^www\./, "");
            } catch {
              return "";
            }
          })(),
          publishedDate: null,
          provider: "brave",
        });
        // Cap URLs (hard limit enforced above via request param; defensive duplicate cap)
        if (sources.length >= HARD_MAX_URLS) break;
      }
    }

    // Deduplicate by URL (last wins; stable order kept)
    const seen = new Set<string>();
    const deduped: SearchSource[] = [];
    for (const s of sources) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      deduped.push(s);
    }

    // Defensive caps on output (honor caller limits with hard ceiling)
    const allowedUrls = Math.min(Math.max(1, Number(options?.maximum_number_of_urls) || DEFAULT_MAX_URLS), HARD_MAX_URLS);
    const finalSources = deduped.slice(0, allowedUrls);

    const tokenEstimate = finalSources.reduce((sum, s) => sum + Math.ceil(s.snippet.length / 4), 0); // approximate
    const cappedEstimate = Math.min(tokenEstimate, HARD_MAX_TOKENS);

    return {
      ok: true,
      provider: LLM_CONTEXT_PROVIDER,
      sources: finalSources,
      tookMs: Date.now() - start,
      contextTokenEstimate: cappedEstimate,
    };
  } catch (error) {
    // Timeout / abort / network failure — never expose token or endpoint
    const isTimeout = error instanceof Error && (error.name === "AbortError" || String(error.message).includes("abort"));
    return {
      ok: false,
      code: isTimeout ? "LLMContextTimeout" : "LLMContextFailed",
      message: isTimeout ? "Brave LLM Context request timed out." : "Brave LLM Context request failed.",
      tookMs: Date.now() - start,
    };
  }
}

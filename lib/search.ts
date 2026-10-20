/**
 * Web search provider adapters.
 *
 * Three interchangeable backends, all optional:
 *   - brave    (BRAVE_SEARCH_API_KEY)  GET  https://api.search.brave.com/res/v1/web/search
 *   - tavily   (TAVILY_API_KEY)        POST https://api.tavily.com/search
 *   - searxng  (SEARXNG_URL)           GET  {SEARXNG_URL}/search?format=json
 *
 * Verified against the providers' current documentation (Brave Web Search
 * API: GET /res/v1/web/search, X-Subscription-Token header, count max 20;
 * Tavily: POST /search, Authorization: Bearer, max_results/maxResults).
 *
 * Nothing here throws: every failure is a typed result so the route can map
 * it to an honest HTTP status and the UI can show a real error state.
 */

export type SearchProviderName = "brave" | "tavily" | "searxng";

export interface SearchSource {
  /** Citation index, 1-based, stable for this response. */
  index: number;
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedDate: string | null;
  provider: SearchProviderName;
}

export type SearchFailureReason =
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "failed"
  | "bad_response";

export interface SearchSuccess {
  ok: true;
  query: string;
  provider: SearchProviderName;
  sources: SearchSource[];
  tookMs: number;
}

export interface SearchFailure {
  ok: false;
  reason: SearchFailureReason;
  message: string;
  tookMs: number;
}

export type SearchResult = SearchSuccess | SearchFailure;

const SEARCH_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 8;

function providerFromEnv(): SearchProviderName | null {
  const explicit = process.env.BDM_SEARCH_PROVIDER?.trim().toLowerCase();
  if (
    explicit === "brave" ||
    explicit === "tavily" ||
    explicit === "searxng"
  ) {
    return explicit;
  }

  // Auto-detect, in order of signal quality.
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) return "brave";
  if (process.env.TAVILY_API_KEY?.trim()) return "tavily";
  if (process.env.SEARXNG_URL?.trim()) return "searxng";
  return null;
}

export function resolveSearchProvider(): SearchProviderName | null {
  return providerFromEnv();
}

/** Redacted status for the UI. Never includes key values. */
export function searchStatus(): {
  provider: SearchProviderName | null;
  configured: boolean;
} {
  const provider = providerFromEnv();
  if (!provider) return { provider: null, configured: false };

  const configured =
    provider === "brave"
      ? Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim())
      : provider === "tavily"
        ? Boolean(process.env.TAVILY_API_KEY?.trim())
        : Boolean(process.env.SEARXNG_URL?.trim());

  return { provider, configured };
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Only http(s) URLs with a title survive: search results are untrusted. */
function normalize(
  raw: { title?: unknown; url?: unknown; snippet?: unknown; date?: unknown },
  index: number,
  provider: SearchProviderName
): SearchSource | null {
  const title = typeof raw.title === "string" ? stripHtml(raw.title) : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!title || !url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const snippet =
    typeof raw.snippet === "string" ? stripHtml(raw.snippet).slice(0, 1200) : "";
  const publishedDate =
    typeof raw.date === "string" && raw.date.trim() ? raw.date.trim() : null;

  return {
    index,
    title: title.slice(0, 300),
    url: parsed.toString(),
    snippet,
    domain: domainOf(url),
    publishedDate,
    provider
  };
}

function toSources(
  items: Array<{ title?: unknown; url?: unknown; snippet?: unknown; date?: unknown }>,
  provider: SearchProviderName
): SearchSource[] {
  const out: SearchSource[] = [];
  for (const item of items) {
    const source = normalize(item, out.length + 1, provider);
    if (source) out.push(source);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

function failure(
  reason: SearchFailureReason,
  message: string,
  started: number
): SearchFailure {
  return { ok: false, reason, message, tookMs: Date.now() - started };
}

async function searchBrave(
  query: string,
  limit: number
): Promise<SearchSource[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) throw new Error("search not configured");

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(20, limit)));
  url.searchParams.set("safesearch", "moderate");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "X-Subscription-Token": key
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("search unauthorized");
  }
  if (response.status === 429) throw new Error("search rate limited");
  if (!response.ok) throw new Error(`search failed ${response.status}`);

  const data = (await response.json()) as {
    web?: { results?: Array<Record<string, unknown>> };
  };
  const results = data.web?.results ?? [];

  return toSources(
    results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
      date: item.page_age ?? item.age
    })),
    "brave"
  );
}

async function searchTavily(
  query: string,
  limit: number
): Promise<SearchSource[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) throw new Error("search not configured");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      query,
      max_results: limit,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      topic: "general"
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("search unauthorized");
  }
  if (response.status === 429) throw new Error("search rate limited");
  if (!response.ok) throw new Error(`search failed ${response.status}`);

  const data = (await response.json()) as {
    results?: Array<Record<string, unknown>>;
  };

  return toSources(
    (data.results ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.content,
      date: item.published_date ?? item.publishedDate
    })),
    "tavily"
  );
}

async function searchSearxng(
  query: string,
  limit: number
): Promise<SearchSource[]> {
  const base = process.env.SEARXNG_URL?.trim();
  if (!base) throw new Error("search not configured");

  // Relative to the configured base so a self-hosted instance behind a
  // sub-path (for example https://host/searxng/) keeps that prefix.
  const url = new URL("search", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("search unauthorized");
  }
  if (response.status === 429) throw new Error("search rate limited");
  if (!response.ok) throw new Error(`search failed ${response.status}`);

  const data = (await response.json()) as {
    results?: Array<Record<string, unknown>>;
  };

  return toSources(
    (data.results ?? []).slice(0, limit).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.content,
      date: item.publishedDate
    })),
    "searxng"
  );
}

/**
 * Run a search through the configured provider.
 *
 * The provider is chosen once from the environment; a failure is reported,
 * never silently retried against a different backend (which could send the
 * user's query somewhere they did not choose).
 */
export async function searchWeb(
  query: string,
  options: { limit?: number } = {}
): Promise<SearchResult> {
  const started = Date.now();
  const provider = providerFromEnv();
  if (!provider) {
    return failure(
      "not_configured",
      "search not configured",
      started
    );
  }

  const limit = Math.min(MAX_RESULTS, Math.max(1, options.limit ?? 5));

  try {
    const sources =
      provider === "brave"
        ? await searchBrave(query, limit)
        : provider === "tavily"
          ? await searchTavily(query, limit)
          : await searchSearxng(query, limit);

    return { ok: true, query, provider, sources, tookMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : "";

    if (
      message.includes("search not configured") ||
      message.includes("search unauthorized") ||
      message.includes("search rate limited")
    ) {
      const reason: SearchFailureReason = message.includes("not configured")
        ? "not_configured"
        : message.includes("unauthorized")
          ? "unauthorized"
          : "rate_limited";
      return failure(reason, message, started);
    }

    // AbortSignal.timeout surfaces as TimeoutError / AbortError depending on
    // the runtime; both mean the provider did not answer in time.
    if (
      name === "TimeoutError" ||
      name === "AbortError" ||
      message.includes("TimeoutError") ||
      message.includes("aborted") ||
      message.includes("AbortError")
    ) {
      return failure("timeout", "search timeout", started);
    }

    return failure("failed", "search failed", started);
  }
}

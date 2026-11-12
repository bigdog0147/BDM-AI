import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/auth";
import { safeError } from "../../../../lib/errors";
import { createRateLimiter, requestKey } from "../../../../lib/rate-limit";
import {
  consumeSharedQuota,
  consumeUserQuota,
  quotaLimits,
  retryAfterSeconds
} from "../../../../lib/quota";
import { searchLLMContext } from "../../../../lib/braveLlmContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });

const ALLOWED_OPTIONS_KEYS = new Set([
  "country", "search_lang", "count", "safesearch", "spellcheck",
  "maximum_number_of_urls", "maximum_number_of_tokens",
  "maximum_number_of_snippets", "context_threshold_mode",
  "maximum_number_of_tokens_per_url", "maximum_number_of_snippets_per_url",
  "freshness", "enable_source_metadata",
]);

function isSafeQuery(query: unknown): { ok: true; query: string } | { ok: false; reason: string } {
  if (typeof query !== "string") return { ok: false, reason: "empty" };
  const trimmed = query.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > 600) return { ok: false, reason: "too_long" };
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length > 75) return { ok: false, reason: "too_long" };
  return { ok: true, query: trimmed };
}

export async function POST(request: Request): Promise<Response> {
  // Feature-flag: must be explicitly enabled; missing/invalid/empty disables.
  const flag = String(process.env.BDM_SEARCH_LLM_CONTEXT_PROVIDER ?? "").trim().toLowerCase();
  if (flag !== "enabled" && flag !== "brave-llm-context") {
    return NextResponse.json(
      {
        error: "LLM Context adapter is disabled. Set BDM_SEARCH_LLM_CONTEXT_PROVIDER=enabled to use.",
        configured: false,
      },
      { status: 503 }
    );
  }

  const decision = limiter.check(requestKey(request));
  if (decision.limited) {
    return NextResponse.json(
      { error: "Too many LLM Context requests. Please slow down." },
      { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { query?: unknown; options?: Record<string, unknown> } | null;
  const validation = isSafeQuery(payload?.query);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error:
          validation.reason === "too_long"
            ? "Query exceeds 600 characters or 75 words."
            : "A research query is required.",
      },
      { status: 400 }
    );
  }

  // Filter allowed option keys only (never pass caller-controlled headers/URLs)
  const safeOptions: Record<string, unknown> = {};
  if (payload?.options && typeof payload.options === "object" && payload.options !== null) {
    for (const key of Object.keys(payload.options)) {
      if (ALLOWED_OPTIONS_KEYS.has(key)) {
        safeOptions[key] = (payload.options as Record<string, unknown>)[key];
      }
    }
  }

  const user = await currentUser();
  const limits = quotaLimits();
  const quota = user
    ? await consumeUserQuota("llm_context.daily", "day", limits.researchDaily)
    : await consumeSharedQuota(
        `ip:${requestKey(request)}`,
        "llm_context.anon.daily",
        "day",
        limits.researchDaily
      );

  if (!quota.ok) {
    if (quota.reason === "limited") {
      return NextResponse.json(
        {
          error: `Daily LLM Context limit (${quota.limit}) reached. Try again tomorrow.`,
          resetAt: quota.resetAt,
        },
        { status: 429, headers: { "retry-after": String(retryAfterSeconds(quota.resetAt)) } }
      );
    }
    return NextResponse.json(
      { error: "The usage quota store is not available, so LLM Context is disabled.", reason: "quota_unavailable" },
      { status: 503 }
    );
  }

  const adapterResult = await searchLLMContext(validation.query, safeOptions as never);

  if (!adapterResult.ok) {
    return NextResponse.json(
      {
        error: safeError(adapterResult.message),
        reason: adapterResult.code,
        configured: adapterResult.code !== "LLMContextNotConfigured",
      },
      { status: adapterResult.code === "LLMContextTimeout" ? 504 : adapterResult.code === "LLMContextRateLimited" ? 429 : adapterResult.code === "LLMContextNotConfigured" ? 503 : 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    provider: adapterResult.provider,
    sources: adapterResult.sources,
    tookMs: adapterResult.tookMs,
    contextTokenEstimate: adapterResult.contextTokenEstimate,
  });
}

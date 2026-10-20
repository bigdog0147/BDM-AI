import { NextResponse } from "next/server";
import { generateReply } from "../../../lib/ai";
import { currentUser } from "../../../lib/auth";
import { hashSubject } from "../../../lib/auth-email";
import { safeError, safeErrorStatus } from "../../../lib/errors";
import { persistTurn } from "../../../lib/persist";
import {
  consumeSharedQuota,
  consumeUserQuota,
  quotaLimits,
  retryAfterSeconds
} from "../../../lib/quota";
import { createRateLimiter, requestKey } from "../../../lib/rate-limit";
import {
  buildResearchSystemPrompt,
  buildResearchUserPrompt,
  extractCitationIndices,
  lacksCitations,
  sanitizeCitations,
  validateResearchQuery
} from "../../../lib/research";import { searchStatus, searchWeb } from "../../../lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });

const STATUS_BY_REASON = {
  not_configured: 503,
  unauthorized: 502,
  rate_limited: 429,
  timeout: 504,
  failed: 502,
  bad_response: 502
} as const;

/**
 * POST /api/research
 *
 * Body: { query: string }
 *
 * Only the user's explicit query is sent to the search provider. No
 * conversation history, project documents, or memory is uploaded.
 */
export async function POST(request: Request): Promise<Response> {
  const decision = limiter.check(requestKey(request));
  if (decision.limited) {
    return NextResponse.json(
      { error: "Too many research requests. Please slow down." },
      {
        status: 429,
        headers: { "retry-after": String(decision.retryAfterSeconds) }
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as
    | { query?: unknown; conversationId?: unknown }
    | null;

  const validation = validateResearchQuery(payload?.query);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error:
          validation.reason === "too_long"
            ? "Query is too long"
            : "A research query of at least 3 characters is required"
      },
      { status: 400 }
    );
  }

  const status = searchStatus();
  if (!status.configured) {
    return NextResponse.json(
      {
        error:
          "Web research is not configured. Add a search provider key to enable it.",
        configured: false,
        provider: null
      },
      { status: 503 }
    );
  }

  // Research costs a search call plus an AI call. Signed-in users have a
  // per-user daily allowance; anonymous callers share one keyed by IP hash.
  const limits = quotaLimits();
  const user = await currentUser();
  const quota = user
    ? await consumeUserQuota("research.daily", "day", limits.researchDaily)
    : await consumeSharedQuota(
        hashSubject(`ip:${requestKey(request)}`),
        "research.anon.daily",
        "day",
        limits.researchDaily
      );

  if (!quota.ok) {
    if (quota.reason === "limited") {
      return NextResponse.json(
        {
          error: `Daily research limit (${quota.limit}) reached. Try again tomorrow.`,
          resetAt: quota.resetAt
        },
        {
          status: 429,
          headers: { "retry-after": String(retryAfterSeconds(quota.resetAt)) }
        }
      );
    }
    return NextResponse.json(
      {
        error:
          "The usage quota store is not available, so research is disabled to prevent unbounded spend.",
        reason: "quota_unavailable"
      },
      { status: 503 }
    );
  }

  const search = await searchWeb(validation.query, { limit: 5 });

  if (!search.ok) {
    return NextResponse.json(
      {
        error: safeError(search.message),
        reason: search.reason,
        configured: search.reason !== "not_configured",
        provider: status.provider
      },
      { status: STATUS_BY_REASON[search.reason] ?? 502 }
    );
  }

  if (search.sources.length === 0) {
    return NextResponse.json({
      answer:
        "I searched but found no suitable sources for that question, so I can't give you a sourced answer. Try rephrasing it or being more specific.",
      sources: [],
      citations: [],
      uncertain: true,
      provider: { search: search.provider, ai: null },
      model: null,
      tookMs: search.tookMs,
      searchedAt: new Date().toISOString()
    });
  }

  let answer: string;
  let model: string;
  let provider: "ollama" | "openai";

  try {
    const generated = await generateReply({
      system: buildResearchSystemPrompt(),
      user: buildResearchUserPrompt(validation.query, search.sources)
    });
    // Drop any citation marker that does not match a provided source, so an
    // invented [7] is never displayed next to a five-item source list.
    answer = sanitizeCitations(generated.text, search.sources.length);
    model = generated.model;
    provider = generated.provider;
  } catch (error) {
    console.error("BDM research synthesis error", error);
    const message = error instanceof Error ? error.message : String(error);
    // Sources are still returned: the search itself succeeded, and hiding
    // them would make a partial failure look like no research happened.
    return NextResponse.json(
      {
        error: safeError(message),
        sources: search.sources,
        provider: { search: search.provider, ai: null },
        searchedAt: new Date().toISOString()
      },
      { status: safeErrorStatus(message) }
    );
  }

  const citations = extractCitationIndices(answer, search.sources.length);

  // Keep the thread: the question and the sourced answer become part of the
  // same conversation, with the sources stored in the existing jsonb column.
  const conversationId = await persistTurn({
    userMessage: validation.query,
    assistantText: answer,
    model,
    conversationId:
      typeof payload?.conversationId === "string" && payload.conversationId.trim()
        ? payload.conversationId.trim()
        : null,
    assistantSources: search.sources
  });

  return NextResponse.json({
    answer,
    sources: search.sources,
    citations,
    // Surfaced honestly rather than silently tolerated.
    missingCitations: lacksCitations(answer, search.sources.length),
    provider: { search: search.provider, ai: provider },
    model,
    tookMs: search.tookMs,
    conversationId
  });
}

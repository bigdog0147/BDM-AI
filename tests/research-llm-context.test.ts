/**
 * Mocked endpoint tests for app/api/research/llm-context/route.ts
 * No real provider calls; synthetic env only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SEARCH_KEYS = [
  "BDM_SEARCH_LLM_CONTEXT_PROVIDER",
  "BRAVE_LLM_CONTEXT_SUBSCRIPTION_TOKEN",
] as const;

let original: Record<string, string | undefined> = {};

beforeEach(() => {
  original = {};
  for (const k of SEARCH_KEYS) original[k] = process.env[k];
  for (const k of SEARCH_KEYS) delete process.env[k];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of SEARCH_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

vi.mock("../lib/braveLlmContext", async () => {
  const actual = await import("../lib/braveLlmContext");
  return {
    ...actual,
    searchLLMContext: vi.fn(async () => ({
      ok: true,
      provider: "brave" as const,
      sources: [
        { index: 1, title: "Synthetic", url: "https://example.com/synth", snippet: "snippet", domain: "example.com", publishedDate: null, provider: "brave" as const },
      ],
      tookMs: 123,
      contextTokenEstimate: 10,
    })),
  };
});

vi.mock("../lib/auth", async () => ({
  currentUser: vi.fn(async () => ({ id: "test-user", email: "t@example.com" }))
}));

vi.mock("../lib/quota", async () => ({
  quotaLimits: vi.fn(() => ({
    researchDaily: 10, researchBurst: 5,
    imageDaily: 10, imageBurst: 5,
    transcribeDaily: 10, transcribeBurst: 5,
    emailDaily: 10, verifyEmailDaily: 10, verifyAttemptHourly: 10
  })),
  consumeSharedQuota: vi.fn(async () => ({ ok: true, limit: 10, used: 0, remaining: 10, resetAt: new Date().toISOString() })),
  consumeUserQuota: vi.fn(async () => ({ ok: true, limit: 10, used: 0, remaining: 10, resetAt: new Date().toISOString() }))
}));

describe("POST /api/research/llm-context (mocked endpoint)", () => {
  it("returns disabled when BDM_SEARCH_LLM_CONTEXT_PROVIDER missing", async () => {
    const { POST } = await import("../app/api/research/llm-context/route");
    const resp = await POST(new Request("http://localhost/", { method: "POST", body: JSON.stringify({ query: "q" }) }));
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.configured).toBe(false);
  });

  it("returns disabled when feature flag invalid", async () => {
    process.env.BDM_SEARCH_LLM_CONTEXT_PROVIDER = "wrong";
    const { POST } = await import("../app/api/research/llm-context/route");
    const resp = await POST(new Request("http://localhost/", { method: "POST", body: JSON.stringify({ query: "q" }) }));
    expect(resp.status).toBe(503);
  });

  it("returns 400 for empty query", async () => {
    process.env.BDM_SEARCH_LLM_CONTEXT_PROVIDER = "enabled";
    process.env.BRAVE_LLM_CONTEXT_SUBSCRIPTION_TOKEN = "synthetic-token";
    const { POST } = await import("../app/api/research/llm-context/route");
    const resp = await POST(new Request("http://localhost/", { method: "POST", body: JSON.stringify({ query: "  " }) }));
    expect(resp.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    process.env.BDM_SEARCH_LLM_CONTEXT_PROVIDER = "enabled";
    process.env.BRAVE_LLM_CONTEXT_SUBSCRIPTION_TOKEN = "synthetic-token";
    const { POST } = await import("../app/api/research/llm-context/route");
    const resp = await POST(new Request("http://localhost/", { method: "POST", body: "not json" }));
    expect(resp.status).toBe(400);
  });

  it("returns 200 with adapter result when enabled (adapter mocked via module mock)", async () => {
    process.env.BDM_SEARCH_LLM_CONTEXT_PROVIDER = "enabled";
    process.env.BRAVE_LLM_CONTEXT_SUBSCRIPTION_TOKEN = "synthetic-token";

    // Mock already set at top level; adapter will use mock directly when route imports it.
    const { POST } = await import("../app/api/research/llm-context/route");
    const resp = await POST(new Request("http://localhost/", { method: "POST", body: JSON.stringify({ query: "test" }) }));
    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.ok).toBe(true);
    expect(json.provider).toBe("brave");
    expect(json.sources).toBeDefined();
  });

  it("preserves existing adapter behavior (regression check)", async () => {
    const { resolveSearchProvider } = await import("../lib/search");
    expect(typeof resolveSearchProvider).toBe("function");
  });
});

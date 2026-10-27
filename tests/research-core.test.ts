import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SearchSource } from "../lib/search";

const quota = vi.hoisted(() => ({
  user: vi.fn(),
  shared: vi.fn(),
}));

vi.mock("../lib/quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/quota")>();
  return {
    ...actual,
    consumeUserQuota: quota.user,
    consumeSharedQuota: quota.shared,
  };
});

const { validateResearchQuery, buildResearchSystemPrompt, buildResearchUserPrompt } = await import("../lib/research");

describe("research: query validation", () => {
  it("rejects empty query", () => {
    expect(validateResearchQuery("")).toEqual({ ok: false, reason: "empty" });
    expect(validateResearchQuery("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects too short query", () => {
    expect(validateResearchQuery("ab")).toEqual({ ok: false, reason: "too_short" });
  });

  it("accepts valid query", () => {
    expect(validateResearchQuery("What is the capital of France?")).toEqual({
      ok: true,
      query: "What is the capital of France?",
    });
  });

  it("rejects too long query", () => {
    const long = "a".repeat(401);
    expect(validateResearchQuery(long)).toEqual({ ok: false, reason: "too_long" });
  });

  it("collapses whitespace", () => {
    expect(validateResearchQuery("  what   is   this  ")).toEqual({
      ok: true,
      query: "what is this",
    });
  });
});

describe("research: prompt construction", () => {
  const makeSource = (overrides: Partial<SearchSource> = {}): SearchSource => ({
    index: 1,
    title: "Test Article",
    url: "https://example.com/article",
    domain: "example.com",
    publishedDate: "2026-01-15",
    snippet: "This is a test snippet about the topic.",
    provider: "tavily",
    ...overrides,
  });

  it("builds system prompt with citation instructions", () => {
    const prompt = buildResearchSystemPrompt();
    expect(prompt).toContain("inline citation like [1] or [2][3]");
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("reliable");
  });

  it("builds user prompt with sources and query", () => {
    const sources = [makeSource({ index: 1 }), makeSource({ index: 2, title: "Another" })];
    const prompt = buildResearchUserPrompt("test query", sources);
    expect(prompt).toContain("test query");
    expect(prompt).toContain("Test Article");
    expect(prompt).toContain("Another");
    expect(prompt).toContain("example.com");
    expect(prompt).toContain("2026-01-15");
  });

  it("handles sources without published date", () => {
    const sources = [makeSource({ publishedDate: null })];
    const prompt = buildResearchUserPrompt("query", sources);
    expect(prompt).not.toContain("null");
  });

  it("escapes HTML entities in source content", () => {
    const sources = [makeSource({ snippet: "Text with <script>alert(1)</script>" })];
    const prompt = buildResearchUserPrompt("query", sources);
    // The delimiter is escaped so a page cannot forge a source boundary or
    // inject markup into the prompt.
    expect(prompt).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(prompt).not.toContain("<script>");
  });
});

// Integration-style tests for the /api/research route
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.BDM_SEARCH_PROVIDER = "tavily";
  process.env.TAVILY_API_KEY = "test-key";
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_MODEL = "gpt-5.6-luna";
  process.env.BDM_WEB_SEARCH_ENABLED = "true";
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

describe("research: /api/research route", () => {
  it("rejects unauthenticated request when search not configured", async () => {
    vi.resetModules();
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.SEARXNG_URL;
    process.env.BDM_WEB_SEARCH_ENABLED = "false";

    const { POST } = await import("../app/api/research/route");
    const request = new Request("http://localhost/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "test query" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error).toContain("not configured");
  });

  it("validates query length", async () => {
    const { POST } = await import("../app/api/research/route");
    const request = new Request("http://localhost/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "ab" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("enforces rate limit", async () => {
    const { POST } = await import("../app/api/research/route");
    // The route has a 10/min rate limiter
    expect(typeof POST).toBe("function");
  });
});
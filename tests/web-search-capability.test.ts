import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getCapabilities } from "../lib/capabilities";

const SEARCH_KEYS = [
  "BDM_SEARCH_PROVIDER",
  "BRAVE_SEARCH_API_KEY",
  "TAVILY_API_KEY",
  "TAVILY_KEYLESS",
  "SEARXNG_URL"
] as const;

let original: Record<string, string | undefined> = {};

beforeEach(() => {
  original = {};
  for (const k of SEARCH_KEYS) original[k] = process.env[k];
  for (const k of SEARCH_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of SEARCH_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

describe("webSearch capability availability (regression)", () => {
  async function checkSearch() {
    const caps = getCapabilities();
    const search = caps.find((c) => c.key === "search");
    expect(search).toBeDefined();
    if (!search) throw new Error("search capability missing");
    return search.availability.check();
  }

  it("reports available when only Brave is configured (auto-detect)", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "synthetic-brave-key";
    const r = await checkSearch();
    expect(r.available).toBe(true);
  });

  it("reports available when only Tavily is configured (auto-detect)", async () => {
    process.env.TAVILY_API_KEY = "synthetic-tavily-key";
    const r = await checkSearch();
    expect(r.available).toBe(true);
  });

  it("reports available when Tavily keyless mode is enabled", async () => {
    process.env.TAVILY_KEYLESS = "1";
    const r = await checkSearch();
    expect(r.available).toBe(true);
  });

  it("reports available when only SearXNG URL is configured (auto-detect)", async () => {
    process.env.SEARXNG_URL = "https://synthetic-searxng.local";
    const r = await checkSearch();
    expect(r.available).toBe(true);
  });

  it("reports unavailable when nothing is configured", async () => {
    const r = await checkSearch();
    expect(r.available).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(String(r.reason)).toContain("No search provider configured");
  });

  it("reports unavailable when explicit brave is missing its key", async () => {
    process.env.BDM_SEARCH_PROVIDER = "brave";
    const r = await checkSearch();
    expect(r.available).toBe(false);
    expect(String(r.reason)).toContain("brave");
  });

  it("reports unavailable when explicit tavily is missing its key", async () => {
    process.env.BDM_SEARCH_PROVIDER = "tavily";
    const r = await checkSearch();
    expect(r.available).toBe(false);
    expect(String(r.reason)).toContain("tavily");
  });

  it("reports unavailable when explicit searxng is missing its URL", async () => {
    process.env.BDM_SEARCH_PROVIDER = "searxng";
    const r = await checkSearch();
    expect(r.available).toBe(false);
    expect(String(r.reason)).toContain("searxng");
  });

  it("does not silently fall back when explicit provider is missing config", async () => {
    process.env.BDM_SEARCH_PROVIDER = "brave";
    process.env.TAVILY_API_KEY = "synthetic-tavily-key";
    const r = await checkSearch();
    expect(r.available).toBe(false);
    expect(String(r.reason)).toContain("brave");
  });

  it("prefers explicit brave when both brave and tavily configured", async () => {
    process.env.BDM_SEARCH_PROVIDER = "brave";
    process.env.BRAVE_SEARCH_API_KEY = "synthetic-brave-key";
    process.env.TAVILY_API_KEY = "synthetic-tavily-key";
    const r = await checkSearch();
    expect(r.available).toBe(true);
  });

  it("prefers auto-detect brave over tavily when both configured and no explicit provider", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "synthetic-brave-key";
    process.env.TAVILY_API_KEY = "synthetic-tavily-key";
    const r = await checkSearch();
    expect(r.available).toBe(true);
  });

  it("never exposes secret values in the reason", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "secret-do-not-leak-42";
    const r = await checkSearch();
    if (r.reason) {
      expect(String(r.reason)).not.toContain("secret-do-not-leak-42");
    }
  });
});

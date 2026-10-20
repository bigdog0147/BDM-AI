import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Memory } from "../lib/bdm-types";

/**
 * Memory tests.
 *
 * The pure rules (secret refusal, command parsing, relevance, project
 * scoping) are tested directly. The store is tested against a fake Supabase
 * client so no database is required, which lets the suite prove the
 * user_id filter is actually applied on every query.
 */

// ---------------------------------------------------------------- fixtures

function memory(partial: Partial<Memory>): Memory {
  return {
    id: partial.id ?? "mem-1",
    user_id: partial.user_id ?? "user-a",
    kind: partial.kind ?? "fact",
    content: partial.content ?? "something",
    importance: partial.importance ?? 50,
    source_conversation_id: partial.source_conversation_id ?? null,
    metadata: partial.metadata ?? {},
    pinned: partial.pinned ?? false,
    expires_at: partial.expires_at ?? null,
    created_at: partial.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00Z"
  };
}

type Result = { data?: unknown; error?: unknown };

function chainFor(result: Result) {
  const chain: Record<string, unknown> = {};
  const passthrough = [
    "select",
    "insert",
    "update",
    "delete",
    "upsert",
    "eq",
    "in",
    "is",
    "order",
    "limit",
    "contains"
  ];
  for (const method of passthrough) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => result);
  // Supabase builders are thenable.
  chain.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const fakeClient = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeClient.current)
}));

vi.mock("../lib/auth", () => ({
  currentUser: vi.fn(async () => null)
}));

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.clearAllMocks();
  vi.resetModules();
});

// ------------------------------------------------------------- pure rules

describe("memory safety", () => {
  it("refuses to persist anything that looks like a credential", async () => {
    const { containsSecret } = await import("../lib/memory-core");
    expect(containsSecret("my key is sk-abcdefghijklmnopqrstuvwxyz123456")).toBe(true);
    expect(containsSecret("password: hunter2hunter2")).toBe(true);
    expect(containsSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(containsSecret("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe(true);
    expect(containsSecret("I prefer dark mode")).toBe(false);
  });

  it("stores nothing when a secret is detected, and never calls the database", async () => {
    const insert = vi.fn();
    fakeClient.current = { from: () => ({ insert }) };
    const { saveMemory } = await import("../lib/memory-store");

    const result = await saveMemory({
      userId: "user-a",
      content: "my api key: sk-abcdefghijklmnopqrstuvwxyz123456"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("secret");
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("explicit memory commands", () => {
  it("parses 'remember this' and classifies preferences", async () => {
    const { parseMemoryCommand } = await import("../lib/memory-core");
    const command = parseMemoryCommand("remember this: I prefer short answers");
    expect(command).toEqual({
      action: "remember",
      content: "I prefer short answers",
      kind: "preference"
    });
  });

  it("parses 'remember that ...'", async () => {
    const { parseMemoryCommand } = await import("../lib/memory-core");
    expect(parseMemoryCommand("Please remember that I work at Acme")).toMatchObject({
      action: "remember",
      content: "I work at Acme"
    });
  });

  it("parses 'forget ...'", async () => {
    const { parseMemoryCommand } = await import("../lib/memory-core");
    expect(parseMemoryCommand("forget my favourite colour")).toEqual({
      action: "forget",
      query: "my favourite colour"
    });
  });

  it("does not treat an ordinary question as a memory write", async () => {
    const { parseMemoryCommand } = await import("../lib/memory-core");
    expect(parseMemoryCommand("do you remember what we discussed?")).toBeNull();
    expect(parseMemoryCommand("what did I say about the project?")).toBeNull();
  });

  it("ignores an empty 'remember this' with no content", async () => {
    const { parseMemoryCommand } = await import("../lib/memory-core");
    expect(parseMemoryCommand("remember this")).toBeNull();
  });
});

describe("retrieval relevance", () => {
  it("injects only memories related to the turn", async () => {
    const { selectRelevantMemories } = await import("../lib/memory-core");
    const memories = [
      memory({ id: "1", content: "I prefer TypeScript over JavaScript" }),
      memory({ id: "2", content: "My dog is called Biscuit" }),
      memory({ id: "3", content: "The deploy target is Render" })
    ];

    const selected = selectRelevantMemories(memories, "how do I deploy this?");
    expect(selected.map((m) => m.id)).toEqual(["3"]);
  });

  it("always includes pinned memories", async () => {
    const { selectRelevantMemories } = await import("../lib/memory-core");
    const memories = [
      memory({ id: "1", content: "Unrelated fact", pinned: true }),
      memory({ id: "2", content: "Another unrelated fact" })
    ];
    const selected = selectRelevantMemories(memories, "deploy");
    expect(selected.map((m) => m.id)).toContain("1");
    expect(selected.map((m) => m.id)).not.toContain("2");
  });

  it("returns an empty list rather than throwing when there is nothing", async () => {
    const { selectRelevantMemories, buildMemoryContext } = await import("../lib/memory-core");
    expect(selectRelevantMemories([], "anything")).toEqual([]);
    expect(buildMemoryContext([])).toBe("");
  });
});

describe("project isolation", () => {
  it("hides a memory scoped to a different project", async () => {
    const { isVisibleForProject } = await import("../lib/memory-core");
    const scoped = memory({ metadata: { project: "alpha" } });

    expect(isVisibleForProject(scoped, "alpha")).toBe(true);
    expect(isVisibleForProject(scoped, "beta")).toBe(false);
    expect(isVisibleForProject(scoped, null)).toBe(false);
  });

  it("treats an unscoped memory as global", async () => {
    const { isVisibleForProject } = await import("../lib/memory-core");
    expect(isVisibleForProject(memory({}), "anything")).toBe(true);
  });
});

describe("forget matching", () => {
  it("finds the intended memory by content", async () => {
    const { findMemoriesToForget } = await import("../lib/memory-core");
    const memories = [
      memory({ id: "1", content: "my favourite colour is green" }),
      memory({ id: "2", content: "I prefer TypeScript" })
    ];
    const matches = findMemoriesToForget(memories, "favourite colour");
    expect(matches.map((m) => m.id)).toEqual(["1"]);
  });

  it("finds nothing when the phrase does not match", async () => {
    const { findMemoriesToForget } = await import("../lib/memory-core");
    expect(findMemoriesToForget([memory({ content: "I like tea" })], "quantum physics")).toEqual([]);
  });

  it("never treats a token-less query as a wildcard", async () => {
    const { findMemoriesToForget } = await import("../lib/memory-core");
    const memories = [
      memory({ id: "1", content: "my favourite colour is green" }),
      memory({ id: "2", content: "this note mentions the deploy target" })
    ];

    // "this" / "it" / "a" are stopwords or too short to identify a row.
    // Substring matching here used to select nearly every memory.
    expect(findMemoriesToForget(memories, "this")).toEqual([]);
    expect(findMemoriesToForget(memories, "it")).toEqual([]);
    expect(findMemoriesToForget(memories, "a")).toEqual([]);
    expect(findMemoriesToForget(memories, "")).toEqual([]);
  });

  it("matches whole words, not fragments of unrelated words", async () => {
    const { findMemoriesToForget } = await import("../lib/memory-core");
    const memories = [memory({ id: "1", content: "I work as a teacher" })];
    expect(findMemoriesToForget(memories, "tea")).toEqual([]);
    expect(memories.length).toBe(1);
  });

  it("still matches a distinctive single word", async () => {
    const { findMemoriesToForget } = await import("../lib/memory-core");
    const memories = [memory({ id: "1", content: "I like tea" })];
    expect(findMemoriesToForget(memories, "tea").map((m) => m.id)).toEqual(["1"]);
  });

  it("needs at least two tokens for a partial match", async () => {
    const { findMemoriesToForget } = await import("../lib/memory-core");
    const memories = [
      memory({ id: "1", content: "the alpha project ships on fridays" }),
      memory({ id: "2", content: "I like tea" })
    ];
    const matches = findMemoriesToForget(memories, "alpha project deadline");
    expect(matches.map((m) => m.id)).toEqual(["1"]);
  });
});

// -------------------------------------------------------------- data layer

describe("memory store scoping", () => {
  it("filters every list query by the authenticated user", async () => {
    const chain = chainFor({ data: [], error: null });
    fakeClient.current = { from: vi.fn(() => chain) };
    const { listMemories } = await import("../lib/memory-store");

    await listMemories("user-a");

    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-a");
  });

  it("records user_id and project scope on insert", async () => {
    const inserted = memory({});
    const chain = chainFor({ data: inserted, error: null });
    const insert = vi.fn(() => chain);
    fakeClient.current = { from: vi.fn(() => ({ insert })) };
    const { saveMemory } = await import("../lib/memory-store");

    const result = await saveMemory({
      userId: "user-a",
      content: "I prefer dark mode",
      kind: "preference",
      project: "bdm-ai"
    });

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-a",
        kind: "preference",
        metadata: { project: "bdm-ai" }
      })
    );
  });

  it("scopes single-row delete by user_id", async () => {
    const chain = chainFor({ data: null, error: null });
    fakeClient.current = { from: vi.fn(() => chain) };
    const { deleteMemory } = await import("../lib/memory-store");

    await deleteMemory("user-a", "mem-9");

    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-a");
  });

  it("does not report success when the delete matched no row", async () => {
    const empty = chainFor({ data: [], error: null });
    fakeClient.current = { from: vi.fn(() => empty) };
    const { deleteMemory } = await import("../lib/memory-store");
    await expect(deleteMemory("user-a", "someone-elses-id")).resolves.toBe(false);

    const found = chainFor({ data: [{ id: "mem-9" }], error: null });
    fakeClient.current = { from: vi.fn(() => found) };
    await expect(deleteMemory("user-a", "mem-9")).resolves.toBe(true);
  });

  it("clears in one user-scoped delete instead of an id list", async () => {
    const chain = chainFor({ data: [{ id: "1" }, { id: "2" }], error: null });
    fakeClient.current = { from: vi.fn(() => chain) };
    const { clearMemories } = await import("../lib/memory-store");

    const removed = await clearMemories("user-a");

    expect(removed).toBe(2);
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-a");
    // No UUID list in the request URL, and no project filter for a full clear.
    expect(chain.in).not.toHaveBeenCalled();
  });

  it("keeps global memories when clearing a single project", async () => {
    const chain = chainFor({ data: [{ id: "1" }], error: null });
    fakeClient.current = { from: vi.fn(() => chain) };
    const { clearMemories } = await import("../lib/memory-store");

    const removed = await clearMemories("user-a", { project: "alpha" });

    expect(removed).toBe(1);
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(chain.eq).toHaveBeenCalledWith("metadata->>project", "alpha");
  });

  it("rejects a secret on correction", async () => {
    const chain = chainFor({ data: null, error: null });
    fakeClient.current = { from: vi.fn(() => chain) };
    const { updateMemory } = await import("../lib/memory-store");

    const result = await updateMemory("user-a", "mem-1", {
      content: "password: super-secret-value"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("secret");
  });

  it("returns [] instead of throwing when storage is unavailable", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { listMemories, retrieveRelevantMemories } = await import("../lib/memory-store");
    await expect(listMemories("user-a")).resolves.toEqual([]);
    await expect(retrieveRelevantMemories("user-a", "anything")).resolves.toEqual([]);
  });
});

describe("memory API authentication", () => {
  it("returns 401 for every memory endpoint when signed out", async () => {
    const list = await import("../app/api/memories/route");
    const single = await import("../app/api/memories/[id]/route");

    const getRes = await list.GET(new Request("http://localhost/api/memories"));
    expect(getRes.status).toBe(401);

    const postRes = await list.POST(
      new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ content: "hello" })
      })
    );
    expect(postRes.status).toBe(401);

    const delRes = await list.DELETE(
      new Request("http://localhost/api/memories", { method: "DELETE" })
    );
    expect(delRes.status).toBe(401);

    const patchRes = await single.PATCH(
      new Request("http://localhost/api/memories/x", { method: "PATCH", body: "{}" }),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(patchRes.status).toBe(401);

    const delOneRes = await single.DELETE(
      new Request("http://localhost/api/memories/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(delOneRes.status).toBe(401);
  });
});

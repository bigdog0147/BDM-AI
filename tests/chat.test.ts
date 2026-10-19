import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// The provider layer defaults to local Ollama. These tests mock global fetch
// so no real Ollama or OpenAI call is ever made.

const ENV_KEYS = [
  "AI_PROVIDER",
  "OLLAMA_MODEL",
  "OLLAMA_FALLBACK_MODEL",
  "OLLAMA_FALLBACK_HOST",
  "OLLAMA_HOST",
  "OLLAMA_API_KEY",
  "OLLAMA_API_HOST",
  "OLLAMA_API_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "BDM_WEB_SEARCH_ENABLED"
] as const;

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

  // Default local-first environment.
  process.env.AI_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  process.env.OLLAMA_HOST = "http://127.0.0.1:11434";
  // No fallback by default: the fallback is opt-in via OLLAMA_FALLBACK_MODEL.
  delete process.env.OLLAMA_FALLBACK_MODEL;
  delete process.env.OLLAMA_FALLBACK_HOST;
  // A real key in the environment must never change what the tests call.
  delete process.env.OLLAMA_API_KEY;
  delete process.env.OLLAMA_API_HOST;
  delete process.env.OLLAMA_API_MODEL;
  // An OpenAI key present here must NEVER be used in ollama mode.
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-secret";
  delete process.env.BDM_WEB_SEARCH_ENABLED;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  // Never let a doMock("openai") leak into a later test.
  vi.doUnmock("openai");
});

function mockOllama(
  body: unknown,
  init?: { ok?: boolean; status?: number }
) {
  const fn = vi.fn(
    async (
      _url: string | URL | Request,
      _init?: RequestInit
    ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => body
    })
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("../app/api/chat/route");
  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return POST(request);
}

const ollamaOk = (text = "Hello from BDM.") => ({
  message: { role: "assistant", content: text },
  done: true
});

/** Mock that answers with a different result on each call. */
function mockOllamaSequence(
  steps: { body: unknown; ok?: boolean; status?: number }[]
) {
  let index = 0;
  const seen: { url: string; init?: RequestInit }[] = [];

  const fn = vi.fn(
    async (
      url: string | URL | Request,
      init?: RequestInit
    ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
      seen.push({ url: String(url), init });
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      return {
        ok: step.ok ?? true,
        status: step.status ?? 200,
        json: async () => step.body
      };
    }
  );
  vi.stubGlobal("fetch", fn);
  return { fn, seen };
}

// Hoisted mock for the persistence-wiring tests below (must be top-level).
const persistMock = vi.hoisted(() => vi.fn());

describe("provider selection", () => {
  it("defaults to ollama when AI_PROVIDER is unset", async () => {
    delete process.env.AI_PROVIDER;
    const fetchMock = mockOllama(ollamaOk());
    const res = await post({ message: "hi" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.provider).toBe("ollama");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("calls the local Ollama /api/chat endpoint with a messages payload", async () => {
    const fetchMock = mockOllama(ollamaOk());
    await post({ message: "hello" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.model).toBe("qwen3.5:4b");
    expect(payload.stream).toBe(false);
    expect(payload.messages[0]).toMatchObject({ role: "system" });
    expect(payload.messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("returns the real Ollama response text to the UI", async () => {
    mockOllama(ollamaOk("The capital of France is Paris."));
    const data = await (await post({ message: "capital of France?" })).json();
    expect(data.text).toBe("The capital of France is Paris.");
    expect(data.model).toBe("qwen3.5:4b");
    expect(data.provider).toBe("ollama");
  });

  it("honours OLLAMA_HOST and OLLAMA_MODEL", async () => {
    process.env.OLLAMA_HOST = "http://127.0.0.1:9999";
    process.env.OLLAMA_MODEL = "ornith-1.5:9b";
    const fetchMock = mockOllama(ollamaOk());
    await post({ message: "hi" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:9999/api/chat");
    expect(JSON.parse((init as RequestInit).body as string).model).toBe(
      "ornith-1.5:9b"
    );
  });

  it("selects openai only when explicitly configured", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_MODEL = "gpt-5.6-luna";
    const create = vi.fn(async () => ({ id: "r1", output_text: "hi there" }));
    vi.doMock("openai", () => ({
      default: class {
        responses = { create };
      }
    }));
    const data = await (await post({ message: "hi" })).json();
    expect(data.provider).toBe("openai");
    expect(data.text).toBe("hi there");
    expect(create).toHaveBeenCalledOnce();
    vi.doUnmock("openai");
  });

  it("rejects an unknown AI_PROVIDER without falling back to a paid provider", async () => {
    process.env.AI_PROVIDER = "some-paid-thing";
    const fetchMock = mockOllama(ollamaOk());
    const res = await post({ message: "hi" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("AI provider is misconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OpenAI is never used in ollama mode", () => {
  it("does not import or call the OpenAI SDK even when a key exists", async () => {
    // A key is present in the env (set in beforeEach). If the route imported
    // the SDK or called it, this mock would record a call.
    const create = vi.fn(async () => ({ output_text: "SHOULD NOT HAPPEN" }));
    vi.doMock("openai", () => ({
      default: class {
        responses = { create };
      }
    }));

    const fetchMock = mockOllama(ollamaOk("local answer"));
    const data = await (await post({ message: "hi" })).json();

    expect(data.text).toBe("local answer");
    expect(create).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("11434");
    vi.doUnmock("openai");
  });
});

describe("Ollama failure handling", () => {
  it("reports Ollama unreachable with a safe message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      })
    );
    const res = await post({ message: "hi" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Ollama) is not running");
  });

  it("reports a missing model (404) safely", async () => {
    mockOllama({}, { ok: false, status: 404 });
    expect((await (await post({ message: "hi" })).json()).error).toContain(
      "not installed"
    );
  });

  it("reports a timeout safely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      })
    );
    expect((await (await post({ message: "hi" })).json()).error).toContain(
      "timed out"
    );
  });

  it("reports a malformed Ollama response safely", async () => {
    const fn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      }
    }));
    vi.stubGlobal("fetch", fn);
    expect((await (await post({ message: "hi" })).json()).error).toContain(
      "unexpected response"
    );
  });

  it("reports an empty Ollama response safely", async () => {
    mockOllama({ message: { role: "assistant", content: "   " } });
    expect((await (await post({ message: "hi" })).json()).error).toContain(
      "unexpected response"
    );
  });

  it("reports a non-200 Ollama error safely", async () => {
    mockOllama({}, { ok: false, status: 500 });
    expect((await (await post({ message: "hi" })).json()).error).toContain(
      "reported an error"
    );
  });

  it("reports a missing OLLAMA_MODEL safely", async () => {
    delete process.env.OLLAMA_MODEL;
    mockOllama(ollamaOk());
    expect((await (await post({ message: "hi" })).json()).error).toBe(
      "Local model is not configured"
    );
  });
});

describe("validation (unchanged)", () => {
  it("rejects a missing message", async () => {
    mockOllama(ollamaOk());
    expect((await post({})).status).toBe(400);
  });

  it("rejects an empty or whitespace message", async () => {
    mockOllama(ollamaOk());
    expect((await post({ message: "  " })).status).toBe(400);
  });

  it("rejects an oversized message", async () => {
    mockOllama(ollamaOk());
    expect((await post({ message: "x".repeat(20001) })).status).toBe(413);
  });

  it("rejects invalid JSON", async () => {
    mockOllama(ollamaOk());
    const { POST } = await import("../app/api/chat/route");
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad"
    });
    expect((await POST(request)).status).toBe(400);
  });

  it("trims whitespace before sending", async () => {
    const fetchMock = mockOllama(ollamaOk());
    await post({ message: "  hi  " });
    const payload = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(payload.messages[1].content).toBe("hi");
  });
});

describe("rate limiting (unchanged)", () => {
  it("returns 429 once the per-window limit is exceeded", async () => {
    mockOllama(ollamaOk());
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      statuses.push((await post({ message: "hi" })).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses[0]).toBe(200);
  });
});

describe("conversation persistence wiring", () => {
  // persistTurn is mocked so these tests prove the ROUTE calls it with the
  // right arguments and surfaces the returned conversationId - independent
  // of whether a Supabase session exists.
  beforeEach(() => {
    persistMock.mockReset();
    // Default: signed-in path saves and returns a conversation id.
    persistMock.mockResolvedValue("convo-123");
    vi.doMock("../lib/persist", () => ({ persistTurn: persistMock }));
  });

  afterEach(() => {
    vi.doUnmock("../lib/persist");
  });

  it("calls persistTurn with the user message, reply, and model", async () => {
    mockOllama(ollamaOk("saved reply"));
    const res = await post({ message: "remember this" });
    expect(res.status).toBe(200);
    expect(persistMock).toHaveBeenCalledOnce();
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: "remember this",
        assistantText: "saved reply",
        model: "qwen3.5:4b"
      })
    );
  });

  it("returns the conversationId from persistTurn to the client", async () => {
    mockOllama(ollamaOk());
    const data = await (await post({ message: "hi" })).json();
    expect(data.conversationId).toBe("convo-123");
  });

  it("forwards a client-supplied conversationId to persistTurn", async () => {
    mockOllama(ollamaOk());
    await post({ message: "continue", conversationId: "convo-abc" });
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "convo-abc" })
    );
  });

  it("still returns the reply when persistence is unavailable (null)", async () => {
    // Anonymous / unconfigured: persistTurn returns null, chat must not fail.
    persistMock.mockResolvedValue(null);
    mockOllama(ollamaOk("reply without saving"));
    const res = await post({ message: "hi" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.text).toBe("reply without saving");
    expect(data.conversationId).toBeNull();
  });

  it("does not persist when the provider call fails", async () => {
    mockOllama(ollamaOk(), { ok: false, status: 500 });
    const res = await post({ message: "hi" });
    expect(res.status).toBe(500);
    expect(persistMock).not.toHaveBeenCalled();
  });
});

describe("hosted model with a local fallback", () => {
  it("falls back to the secondary model when the hosted model is unavailable", async () => {
    process.env.OLLAMA_MODEL = "gemma4:cloud";
    process.env.OLLAMA_FALLBACK_MODEL = "qwen2.5:0.5b";
    const { fn: fetchMock, seen } = mockOllamaSequence([
      { body: {}, ok: false, status: 403 },
      { body: ollamaOk("local answer") }
    ]);

    const res = await post({ message: "hi" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.text).toBe("local answer");
    // The response must name the model that actually answered.
    expect(data.model).toBe("qwen2.5:0.5b");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const first = JSON.parse(seen[0].init?.body as string);
    const second = JSON.parse(seen[1].init?.body as string);
    expect(first.model).toBe("gemma4:cloud");
    expect(second.model).toBe("qwen2.5:0.5b");
  });

  it("does not call the fallback when the primary model answers", async () => {
    process.env.OLLAMA_MODEL = "gemma4:cloud";
    process.env.OLLAMA_FALLBACK_MODEL = "qwen2.5:0.5b";
    const fetchMock = mockOllama(ollamaOk("cloud answer"));

    const data = await (await post({ message: "hi" })).json();
    expect(data.text).toBe("cloud answer");
    expect(data.model).toBe("gemma4:cloud");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports the primary failure when both models fail", async () => {
    process.env.OLLAMA_MODEL = "gemma4:cloud";
    process.env.OLLAMA_FALLBACK_MODEL = "qwen2.5:0.5b";
    mockOllamaSequence([
      { body: {}, ok: false, status: 403 },
      { body: {}, ok: false, status: 404 }
    ]);

    const res = await post({ message: "hi" });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("hosted model is unavailable");
  });

  it("keeps the previous behaviour when no fallback is configured", async () => {
    delete process.env.OLLAMA_FALLBACK_MODEL;
    process.env.OLLAMA_MODEL = "gemma4:cloud";
    const fetchMock = mockOllama({ body: {}, ok: false, status: 403 });

    const res = await post({ message: "hi" });
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("calls the hosted API with a bearer token when a key is configured", async () => {
    process.env.OLLAMA_API_HOST = "https://ollama.com";
    process.env.OLLAMA_API_MODEL = "gemma4:31b";
    process.env.OLLAMA_API_KEY = "test-key";
    const { seen } = mockOllamaSequence([{ body: ollamaOk("hosted answer") }]);

    const data = await (await post({ message: "hi" })).json();
    expect(data.text).toBe("hosted answer");
    expect(data.model).toBe("gemma4:31b");
    expect(seen[0].url).toBe("https://ollama.com/api/chat");
    const headers = seen[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
  });

  it("falls back to the local server and never sends the key to it", async () => {
    process.env.OLLAMA_API_HOST = "https://ollama.com";
    process.env.OLLAMA_API_MODEL = "gemma4:31b";
    process.env.OLLAMA_API_KEY = "test-key";
    process.env.OLLAMA_FALLBACK_MODEL = "qwen2.5:0.5b";
    process.env.OLLAMA_FALLBACK_HOST = "http://127.0.0.1:11434";

    const { seen } = mockOllamaSequence([
      { body: {}, ok: false, status: 403 },
      { body: ollamaOk("local answer") }
    ]);

    const data = await (await post({ message: "hi" })).json();
    expect(data.text).toBe("local answer");
    expect(data.model).toBe("qwen2.5:0.5b");

    // The hosted call carries the key...
    const hostedHeaders = seen[0].init?.headers as Record<string, string>;
    expect(hostedHeaders.authorization).toBe("Bearer test-key");
    // ...and the local fallback must never receive it.
    expect(seen[1].url).toBe("http://127.0.0.1:11434/api/chat");
    const localHeaders = seen[1].init?.headers as Record<string, string>;
    expect(localHeaders.authorization).toBeUndefined();
  });

  it("keeps the local server as the primary when there is no key", async () => {
    const { seen } = mockOllamaSequence([{ body: ollamaOk("local answer") }]);

    const data = await (await post({ message: "hi" })).json();
    expect(data.text).toBe("local answer");
    expect(seen[0].url).toBe("http://127.0.0.1:11434/api/chat");
    const headers = seen[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });
});

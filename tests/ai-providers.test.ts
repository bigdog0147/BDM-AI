import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeError } from "../lib/errors";

// Every provider call is mocked. No test reaches Ollama, OpenAI, or any other
// network service, and no test needs a real key.

const ENV_KEYS = [
  "AI_PROVIDER",
  "AI_FALLBACK_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OLLAMA_MODEL",
  "OLLAMA_API_MODEL",
  "OLLAMA_API_KEY",
  "OLLAMA_API_HOST",
  "OLLAMA_HOST",
  "OLLAMA_FALLBACK_MODEL",
  "OLLAMA_FALLBACK_HOST",
  "RENDER",
  "RENDER_SERVICE_ID"
] as const;

type FetchResult = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
  vi.doUnmock("openai");
  vi.unstubAllGlobals();
  // Any unexpected network call fails loudly instead of reaching the internet.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("unexpected network call");
    })
  );
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.doUnmock("openai");
  vi.resetModules();
  vi.restoreAllMocks();
});

function ollamaReply(text: string): FetchResult {
  return {
    ok: true,
    status: 200,
    json: async () => ({ message: { role: "assistant", content: text } })
  };
}

function httpError(status: number): FetchResult {
  return { ok: false, status, json: async () => ({}) };
}

function mockFetch(
  impl: (url: string, init?: RequestInit) => FetchResult | Promise<FetchResult>
) {
  const fn = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) =>
      impl(String(url), init)
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

type OpenAICreate = (
  input: Record<string, unknown>
) => Promise<{ output_text?: string }>;

function mockOpenAI(create: OpenAICreate) {
  const fn = vi.fn(create);
  vi.doMock("openai", () => ({
    default: class MockOpenAI {
      responses = { create: fn };
    }
  }));
  return fn;
}

function sdkError(status: number, name = "APIError"): Error {
  return Object.assign(new Error(`upstream status ${status}`), { status, name });
}

function useLocalOllama() {
  process.env.AI_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "local-model";
  process.env.OLLAMA_HOST = "http://127.0.0.1:11434";
}

function useOpenAI() {
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-secret";
  process.env.OPENAI_MODEL = "gpt-test";
}

async function generate(args = { system: "sys", user: "usr" }) {
  const { generateReply } = await import("../lib/ai");
  return generateReply(args);
}

describe("provider selection and configuration", () => {
  it("calls OpenAI with the configured key and model", async () => {
    useOpenAI();
    const create = mockOpenAI(async () => ({ output_text: "  hello  " }));

    const result = await generate();

    expect(result).toEqual({
      text: "hello",
      model: "gpt-test",
      provider: "openai"
    });
    expect(create).toHaveBeenCalledWith({
      model: "gpt-test",
      instructions: "sys",
      input: "usr",
      max_output_tokens: 4096
    });
  });

  it("fails actionably when the OpenAI key is missing", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_MODEL = "gpt-test";
    const create = mockOpenAI(async () => ({ output_text: "nope" }));

    await expect(generate()).rejects.toThrow(/OPENAI_API_KEY/);
    expect(create).not.toHaveBeenCalled();
    expect(safeError("OPENAI_API_KEY is not configured")).toBe(
      "AI provider is not configured"
    );
  });

  it("fails actionably when the OpenAI model is missing", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-secret";
    mockOpenAI(async () => ({ output_text: "nope" }));

    await expect(generate()).rejects.toThrow(/OPENAI_MODEL/);
  });

  it("uses Ollama Cloud with OLLAMA_API_KEY and OLLAMA_API_MODEL", async () => {
    process.env.OLLAMA_API_KEY = "test-cloud-key";
    process.env.OLLAMA_API_MODEL = "cloud-model";
    const fetchMock = mockFetch(() => ollamaReply("cloud answer"));

    const result = await generate();

    expect(result).toEqual({
      text: "cloud answer",
      model: "cloud-model",
      provider: "ollama"
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ollama.com/api/chat");
    expect(JSON.parse(init?.body as string).model).toBe("cloud-model");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-cloud-key");
  });

  it("requires OLLAMA_API_MODEL in cloud mode even when OLLAMA_MODEL exists", async () => {
    process.env.OLLAMA_API_KEY = "test-cloud-key";
    process.env.OLLAMA_MODEL = "local-model";
    const fetchMock = mockFetch(() => ollamaReply("must not run"));

    await expect(generate()).rejects.toThrow(/OLLAMA_API_MODEL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-https or localhost Ollama Cloud endpoint", async () => {
    process.env.OLLAMA_API_KEY = "test-cloud-key";
    process.env.OLLAMA_API_MODEL = "cloud-model";
    process.env.OLLAMA_API_HOST = "http://127.0.0.1:11434";
    const fetchMock = mockFetch(() => ollamaReply("must not run"));

    await expect(generate()).rejects.toThrow(/https/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails actionably when the local Ollama model is missing", async () => {
    process.env.AI_PROVIDER = "ollama";
    const fetchMock = mockFetch(() => ollamaReply("must not run"));

    await expect(generate()).rejects.toThrow(/OLLAMA_MODEL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a localhost Ollama on Render", async () => {
    useLocalOllama();
    process.env.RENDER = "true";
    const fetchMock = mockFetch(() => ollamaReply("must not run"));

    await expect(generate()).rejects.toThrow(/localhost/);
    await expect(generate()).rejects.toThrow(/Render/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown AI_PROVIDER", async () => {
    process.env.AI_PROVIDER = "gemini";
    const fetchMock = mockFetch(() => ollamaReply("must not run"));

    await expect(generate()).rejects.toThrow(/Unknown AI_PROVIDER/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown or self-referential fallback provider", async () => {
    useLocalOllama();
    process.env.AI_FALLBACK_PROVIDER = "gemini";
    await expect(generate()).rejects.toThrow(/Unknown AI_FALLBACK_PROVIDER/);

    process.env.AI_FALLBACK_PROVIDER = "ollama";
    await expect(generate()).rejects.toThrow(/must differ/);
  });
});

describe("cross-provider fallback", () => {
  it("falls back to Ollama after an OpenAI 5xx", async () => {
    useOpenAI();
    process.env.AI_FALLBACK_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL = "local-model";
    mockOpenAI(async () => {
      throw sdkError(500, "InternalServerError");
    });
    const fetchMock = mockFetch(() => ollamaReply("fallback answer"));

    const result = await generate();

    expect(result).toEqual({
      text: "fallback answer",
      model: "local-model",
      provider: "ollama",
      fallbackFrom: "openai"
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to Ollama after an OpenAI timeout", async () => {
    useOpenAI();
    process.env.AI_FALLBACK_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL = "local-model";
    mockOpenAI(async () => {
      throw Object.assign(new Error("request timed out"), {
        name: "APIConnectionTimeoutError"
      });
    });
    mockFetch(() => ollamaReply("after timeout"));

    const result = await generate();
    expect(result.provider).toBe("ollama");
    expect(result.fallbackFrom).toBe("openai");
  });

  it("falls back to Ollama after an OpenAI rate limit", async () => {
    useOpenAI();
    process.env.AI_FALLBACK_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL = "local-model";
    mockOpenAI(async () => {
      throw sdkError(429, "RateLimitError");
    });
    mockFetch(() => ollamaReply("after rate limit"));

    const result = await generate();
    expect(result.provider).toBe("ollama");
  });

  it("does not fall back after an OpenAI authentication failure", async () => {
    useOpenAI();
    process.env.AI_FALLBACK_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL = "local-model";
    mockOpenAI(async () => {
      throw sdkError(401, "AuthenticationError");
    });
    const fetchMock = mockFetch(() => ollamaReply("must not run"));

    await expect(generate()).rejects.toThrow(/openai unauthorized/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(safeError("openai unauthorized")).toBe(
      "OpenAI rejected the configured credentials."
    );
  });

  it("does not fall back after an OpenAI bad request", async () => {
    useOpenAI();
    process.env.AI_FALLBACK_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL = "local-model";
    mockOpenAI(async () => {
      throw sdkError(400, "BadRequestError");
    });
    const fetchMock = mockFetch(() => ollamaReply("must not run"));

    await expect(generate()).rejects.toThrow(/openai error 400/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to OpenAI after an Ollama 5xx", async () => {
    useLocalOllama();
    process.env.AI_FALLBACK_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-secret";
    process.env.OPENAI_MODEL = "gpt-test";
    mockFetch(() => httpError(500));
    mockOpenAI(async () => ({ output_text: "openai answer" }));

    const result = await generate();

    expect(result).toEqual({
      text: "openai answer",
      model: "gpt-test",
      provider: "openai",
      fallbackFrom: "ollama"
    });
  });

  it("falls back to OpenAI after an Ollama rate limit", async () => {
    useLocalOllama();
    process.env.AI_FALLBACK_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-secret";
    process.env.OPENAI_MODEL = "gpt-test";
    mockFetch(() => httpError(429));
    mockOpenAI(async () => ({ output_text: "openai answer" }));

    const result = await generate();
    expect(result.provider).toBe("openai");
    expect(result.fallbackFrom).toBe("ollama");
  });

  it("does not cross-fall back after an Ollama authentication failure", async () => {
    useLocalOllama();
    process.env.AI_FALLBACK_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-secret";
    process.env.OPENAI_MODEL = "gpt-test";
    mockFetch(() => httpError(403));
    const create = mockOpenAI(async () => ({ output_text: "must not run" }));

    await expect(generate()).rejects.toThrow(/ollama cloud unavailable/);
    expect(create).not.toHaveBeenCalled();
  });

  it("surfaces the primary error when the fallback is not configured", async () => {
    useOpenAI();
    process.env.AI_FALLBACK_PROVIDER = "ollama";
    // No OLLAMA_MODEL: the fallback cannot be used, and must not hide the
    // actionable primary failure.
    mockOpenAI(async () => {
      throw sdkError(500, "InternalServerError");
    });
    const fetchMock = mockFetch(() => ollamaReply("must not run"));

    await expect(generate()).rejects.toThrow(/openai error 500/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the primary error when the fallback also fails", async () => {
    useOpenAI();
    process.env.AI_FALLBACK_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL = "local-model";
    mockOpenAI(async () => {
      throw sdkError(500, "InternalServerError");
    });
    mockFetch(() => httpError(500));

    await expect(generate()).rejects.toThrow(/openai error 500/);
  });

  it("does not use a fallback when none is configured", async () => {
    useOpenAI();
    mockOpenAI(async () => {
      throw sdkError(500, "InternalServerError");
    });
    const fetchMock = mockFetch(() => ollamaReply("must not run"));

    await expect(generate()).rejects.toThrow(/openai error 500/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Ollama model fallback", () => {
  it("retries a transient failure on the configured model", async () => {
    useLocalOllama();
    process.env.OLLAMA_FALLBACK_MODEL = "backup-model";
    let calls = 0;
    const fetchMock = mockFetch(() =>
      calls++ === 0 ? httpError(500) : ollamaReply("backup answer")
    );

    const result = await generate();

    expect(result.model).toBe("backup-model");
    expect(result.text).toBe("backup answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries an authentication failure", async () => {
    useLocalOllama();
    process.env.OLLAMA_FALLBACK_MODEL = "backup-model";
    const fetchMock = mockFetch(() => httpError(403));

    await expect(generate()).rejects.toThrow(/ollama cloud unavailable/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("status and secret redaction", () => {
  it("reports readiness without exposing credentials", async () => {
    const secret = "sk-live-should-never-leak";
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = secret;
    process.env.OPENAI_MODEL = "gpt-test";
    process.env.AI_FALLBACK_PROVIDER = "ollama";
    process.env.OLLAMA_API_KEY = "cloud-secret-should-not-leak";
    process.env.OLLAMA_API_MODEL = "cloud-model";

    const { aiStatus } = await import("../lib/ai");
    const status = aiStatus();
    const serialized = JSON.stringify(status);

    expect(status).toMatchObject({
      provider: "openai",
      model: "gpt-test",
      configured: true,
      fallback: { provider: "ollama", configured: true }
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("cloud-secret-should-not-leak");
  });

  it("reports Ollama as unconfigured on Render with a localhost host", async () => {
    useLocalOllama();
    process.env.RENDER = "true";
    const { aiStatus } = await import("../lib/ai");

    expect(aiStatus().configured).toBe(false);
  });

  it("never puts a key in a provider error message", async () => {
    const key = "sk-key-that-must-not-appear";
    useOpenAI();
    process.env.OPENAI_API_KEY = key;
    process.env.AI_FALLBACK_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL = "local-model";
    mockOpenAI(async () => {
      throw sdkError(401, "AuthenticationError");
    });

    const error = await generate().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(key);
    expect(JSON.stringify({ message: (error as Error).message })).not.toContain(
      key
    );
  });

  it("keeps an invalid fallback name out of aiStatus instead of throwing", async () => {
    useLocalOllama();
    process.env.AI_FALLBACK_PROVIDER = "not-a-provider";
    const { aiStatus } = await import("../lib/ai");

    expect(aiStatus().fallback).toEqual({ provider: null, configured: false });
  });
});

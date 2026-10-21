import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Provider credit / quota classification.
 *
 * An exhausted OpenAI balance arrives as HTTP 429, exactly like a rate
 * limit. Telling the two apart matters: "try again shortly" is useless
 * advice when the account has no credit left.
 */

const h = vi.hoisted(() => ({
  create: vi.fn(),
  toFile: vi.fn()
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    audio = { transcriptions: { create: h.create } };
  },
  toFile: h.toFile
}));

const ENV_KEYS = ["OPENAI_API_KEY", "BDM_TRANSCRIBE_MODEL"] as const;
let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.OPENAI_API_KEY = "test-key";

  h.create.mockReset();
  h.toFile.mockReset();
  h.toFile.mockImplementation(async (data: unknown, name: string, options: unknown) => ({
    data,
    name,
    options
  }));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("transcription provider failures", () => {
  it("reports an exhausted balance separately from a rate limit", async () => {
    const { transcribeAudio } = await import("../lib/transcribe");

    h.create.mockRejectedValue(
      Object.assign(new Error("429 You have no credits remaining."), {
        status: 429
      })
    );

    const result = await transcribeAudio({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "audio/webm",
      extension: "webm"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_credit");
  });

  it("still reports a plain rate limit as a rate limit", async () => {
    const { transcribeAudio } = await import("../lib/transcribe");

    h.create.mockRejectedValue(
      Object.assign(new Error("429 Too many requests"), { status: 429 })
    );

    const result = await transcribeAudio({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "audio/webm",
      extension: "webm"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("failed");
  });
});

describe("browser-safe error text", () => {
  it("explains an empty balance instead of saying 'try again'", async () => {
    const { safeError } = await import("../lib/errors");

    expect(safeError("openai out of credit")).toMatch(/no credit/i);
    expect(safeError("openai out of credit")).toMatch(/billing/);
    // A real rate limit keeps its own message.
    expect(safeError("openai rate limited")).toMatch(/rate limit/i);
  });
});

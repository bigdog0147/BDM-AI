import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Voice note tests.
 *
 * The transcription provider is mocked, so no audio leaves the machine and
 * no credit is spent. The suite covers validation, missing configuration,
 * provider failures, and the authenticated upload route.
 */

const h = vi.hoisted(() => ({
  create: vi.fn(),
  toFile: vi.fn(),
  currentUser: vi.fn()
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    audio = { transcriptions: { create: h.create } };
  },
  toFile: h.toFile
}));

vi.mock("../lib/auth", () => ({
  currentUser: h.currentUser
}));

const quota = vi.hoisted(() => ({
  user: vi.fn(),
  shared: vi.fn()
}));

vi.mock("../lib/quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/quota")>();
  return {
    ...actual,
    consumeUserQuota: quota.user,
    consumeSharedQuota: quota.shared
  };
});

const ENV_KEYS = ["OPENAI_API_KEY", "BDM_TRANSCRIBE_MODEL"] as const;
let originalEnv: Record<string, string | undefined> = {};

function audioForm(
  bytes: Uint8Array = new Uint8Array([1, 2, 3, 4]),
  type = "audio/webm",
  duration = "3.5"
): FormData {
  const form = new FormData();
  form.append(
    "audio",
    new File([bytes as unknown as BlobPart], "recording.webm", { type })
  );
  form.append("durationSeconds", duration);
  return form;
}

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  delete process.env.OPENAI_API_KEY;
  delete process.env.BDM_TRANSCRIBE_MODEL;

  h.create.mockReset();
  h.toFile.mockReset();
  h.toFile.mockImplementation(async (data: unknown, name: string, options: unknown) => ({
    data,
    name,
    options
  }));
  h.currentUser.mockReset();
  h.currentUser.mockResolvedValue(null);
  quota.user.mockReset();
  quota.user.mockResolvedValue({
    ok: true,
    limit: 50,
    used: 1,
    remaining: 49,
    resetAt: new Date(Date.now() + 86_400_000).toISOString()
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

// ------------------------------------------------------------- validation

describe("audio validation", () => {
  it("accepts MediaRecorder codec parameters", async () => {
    const { normalizeMimeType, extensionForMimeType } = await import("../lib/transcribe");

    expect(normalizeMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(extensionForMimeType("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForMimeType("audio/mp4")).toBe("mp4");
    expect(extensionForMimeType("audio/x-m4a")).toBe("m4a");
    expect(extensionForMimeType("video/mp4")).toBeNull();
  });

  it("rejects unsupported types, empty files, oversized files, and bad durations", async () => {
    const { validateAudio, MAX_AUDIO_BYTES } = await import("../lib/transcribe");

    expect(validateAudio({ mimeType: "text/plain", size: 10, durationSeconds: 2 })).toEqual({
      ok: false,
      reason: "unsupported_type"
    });
    expect(validateAudio({ mimeType: "audio/webm", size: 0, durationSeconds: 2 })).toEqual({
      ok: false,
      reason: "empty"
    });
    expect(
      validateAudio({ mimeType: "audio/webm", size: MAX_AUDIO_BYTES + 1, durationSeconds: 2 })
    ).toEqual({ ok: false, reason: "too_large" });
    expect(
      validateAudio({ mimeType: "audio/webm", size: 10, durationSeconds: 0 })
    ).toEqual({ ok: false, reason: "bad_duration" });
    expect(
      validateAudio({ mimeType: "audio/webm", size: 10, durationSeconds: 301 })
    ).toEqual({ ok: false, reason: "too_long" });
  });

  it("returns the normalized values for a valid recording", async () => {
    const { validateAudio } = await import("../lib/transcribe");

    expect(
      validateAudio({
        mimeType: "audio/webm;codecs=opus",
        size: 2048,
        durationSeconds: 12.34
      })
    ).toEqual({
      ok: true,
      mimeType: "audio/webm",
      extension: "webm",
      durationSeconds: 12.3
    });
  });

  it("declares that audio is not retained", async () => {
    const { transcriptionStatus } = await import("../lib/transcribe");
    const status = transcriptionStatus();

    expect(status.configured).toBe(false);
    expect(status.retention).toBe("not_stored");
    expect(status.maxBytes).toBe(25 * 1024 * 1024);
  });
});

// ------------------------------------------------------------- provider

describe("transcription provider", () => {
  it("does not call the provider without a key", async () => {
    const { transcribeAudio } = await import("../lib/transcribe");
    const result = await transcribeAudio({
      data: new Uint8Array([1]),
      mimeType: "audio/webm",
      extension: "webm"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_configured");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("returns the trimmed transcript and the configured model", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.create.mockResolvedValue({ text: "  hello world  " });

    const { transcribeAudio } = await import("../lib/transcribe");
    const result = await transcribeAudio({
      data: new Uint8Array([1, 2]),
      mimeType: "audio/webm",
      extension: "webm"
    });

    expect(result).toEqual({ ok: true, text: "hello world", model: "gpt-transcribe" });
    expect(h.toFile).toHaveBeenCalled();
  });

  it("treats an empty transcript as a real failure", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.create.mockResolvedValue({ text: "   " });

    const { transcribeAudio } = await import("../lib/transcribe");
    const result = await transcribeAudio({
      data: new Uint8Array([1]),
      mimeType: "audio/webm",
      extension: "webm"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty_transcript");
  });

  it("distinguishes a timeout from a generic failure", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { transcribeAudio } = await import("../lib/transcribe");

    const timeout = new Error("Request timed out");
    timeout.name = "APIConnectionTimeoutError";
    h.create.mockRejectedValueOnce(timeout);
    const timedOut = await transcribeAudio({
      data: new Uint8Array([1]),
      mimeType: "audio/webm",
      extension: "webm"
    });
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) expect(timedOut.reason).toBe("timeout");

    h.create.mockRejectedValueOnce(new Error("boom"));
    const failed = await transcribeAudio({
      data: new Uint8Array([1]),
      mimeType: "audio/webm",
      extension: "webm"
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.reason).toBe("failed");
  });
});

// ---------------------------------------------------------------- route

describe("POST /api/transcribe", () => {
  it("requires authentication", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { POST } = await import("../app/api/transcribe/route");

    const response = await POST(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        body: audioForm()
      })
    );

    expect(response.status).toBe(401);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("returns a configuration-required state without a key", async () => {
    h.currentUser.mockResolvedValue({ id: "user-voice-config", email: "a@b.c" });
    const { POST } = await import("../app/api/transcribe/route");

    const response = await POST(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        headers: { "x-forwarded-for": "10.2.0.1" },
        body: audioForm()
      })
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.configured).toBe(false);
    expect(body.text).toBeUndefined();
  });

  it("rejects an unsupported audio type", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.currentUser.mockResolvedValue({ id: "user-voice-type", email: "a@b.c" });
    const { POST } = await import("../app/api/transcribe/route");

    const response = await POST(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        headers: { "x-forwarded-for": "10.2.0.2" },
        body: audioForm(new Uint8Array([1]), "text/plain")
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.reason).toBe("unsupported_type");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rejects an oversized upload before parsing it", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.currentUser.mockResolvedValue({ id: "user-voice-big", email: "a@b.c" });
    const { POST } = await import("../app/api/transcribe/route");

    const response = await POST(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        headers: {
          "x-forwarded-for": "10.2.0.3",
          "content-length": String(26 * 1024 * 1024)
        },
        body: audioForm()
      })
    );

    expect(response.status).toBe(413);
  });

  it("returns the transcript on success and reports no retention", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.currentUser.mockResolvedValue({ id: "user-voice-ok", email: "a@b.c" });
    h.create.mockResolvedValue({ text: "Remind me to call Sam." });

    const { POST } = await import("../app/api/transcribe/route");
    const response = await POST(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        headers: { "x-forwarded-for": "10.2.0.4" },
        body: audioForm()
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.text).toBe("Remind me to call Sam.");
    expect(body.retention).toBe("not_stored");
    expect(body.model).toBe("gpt-transcribe");
    expect(body.durationSeconds).toBe(3.5);
  });

  it("reports no speech detected instead of returning an empty message", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.currentUser.mockResolvedValue({ id: "user-voice-empty", email: "a@b.c" });
    h.create.mockResolvedValue({ text: "" });

    const { POST } = await import("../app/api/transcribe/route");
    const response = await POST(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        headers: { "x-forwarded-for": "10.2.0.5" },
        body: audioForm()
      })
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toMatch(/no speech/i);
  });
});

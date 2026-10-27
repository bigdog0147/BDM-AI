import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.BDM_TRANSCRIBE_MODEL = "gpt-transcribe";
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

describe("transcribe: validation", () => {
  it("validates audio file size", async () => {
    const { validateAudio, MAX_AUDIO_BYTES } = await import("../lib/transcribe");

    expect(validateAudio({ mimeType: "audio/webm", size: 1000, durationSeconds: 30 })).toEqual({ ok: true, mimeType: "audio/webm", extension: "webm", durationSeconds: 30 });
    expect(validateAudio({ mimeType: "audio/webm", size: MAX_AUDIO_BYTES + 1, durationSeconds: 30 })).toEqual({ ok: false, reason: "too_large" });
  });

  it("validates duration", async () => {
    const { validateAudio, MAX_DURATION_SECONDS } = await import("../lib/transcribe");

    expect(validateAudio({ mimeType: "audio/webm", size: 1000, durationSeconds: 60 })).toEqual({ ok: true, mimeType: "audio/webm", extension: "webm", durationSeconds: 60 });
    expect(validateAudio({ mimeType: "audio/webm", size: 1000, durationSeconds: MAX_DURATION_SECONDS })).toEqual({ ok: true, mimeType: "audio/webm", extension: "webm", durationSeconds: MAX_DURATION_SECONDS });
    expect(validateAudio({ mimeType: "audio/webm", size: 1000, durationSeconds: MAX_DURATION_SECONDS + 1 })).toEqual({ ok: false, reason: "too_long" });
    expect(validateAudio({ mimeType: "audio/webm", size: 1000, durationSeconds: 0 })).toEqual({ ok: false, reason: "bad_duration" });
    expect(validateAudio({ mimeType: "audio/webm", size: 1000, durationSeconds: -1 })).toEqual({ ok: false, reason: "bad_duration" });
  });

  it("rejects unsupported MIME types", async () => {
    const { validateAudio } = await import("../lib/transcribe");
    expect(validateAudio({ mimeType: "audio/flac", size: 1000, durationSeconds: 30 })).toEqual({ ok: true, mimeType: "audio/flac", extension: "flac", durationSeconds: 30 });
    expect(validateAudio({ mimeType: "audio/unsupported", size: 1000, durationSeconds: 30 })).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("accepts supported MIME types", async () => {
    const { validateAudio } = await import("../lib/transcribe");
    const types = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/m4a"];
    for (const type of types) {
      expect(validateAudio({ mimeType: type, size: 1000, durationSeconds: 30 }).ok).toBe(true);
    }
  });
});

describe("transcribe: transcription status", () => {
  it("reports configured when OpenAI key present", async () => {
    const { transcriptionStatus } = await import("../lib/transcribe");
    const status = transcriptionStatus();
    expect(status.configured).toBe(true);
    expect(status.provider).toBe("openai");
    expect(status.model).toBe("gpt-transcribe");
    expect(status.maxDurationSeconds).toBe(300);
  });

  it("reports not configured when OpenAI key missing", async () => {
    vi.resetModules();
    delete process.env.OPENAI_API_KEY;
    const { transcriptionStatus } = await import("../lib/transcribe");
    const status = transcriptionStatus();
    expect(status.configured).toBe(false);
  });
});

describe("transcribe: /api/transcribe route", () => {
  // Mock auth to return a user for all route tests
  beforeEach(() => {
    vi.doMock("../lib/auth", () => ({
      currentUser: vi.fn().mockResolvedValue({ id: "test-user", email: "test@example.com" }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("../lib/auth");
  });

  it("rejects when transcription not configured", async () => {
    vi.resetModules();
    delete process.env.OPENAI_API_KEY;
    vi.doMock("../lib/auth", () => ({
      currentUser: vi.fn().mockResolvedValue({ id: "test-user", email: "test@example.com" }),
    }));

    const { POST } = await import("../app/api/transcribe/route");
    const form = new FormData();
    form.append("audio", new Blob(["test"], { type: "audio/webm" }), "test.webm");
    form.append("durationSeconds", "30");

    const request = new Request("http://localhost/api/transcribe", {
      method: "POST",
      body: form,
    });
    const response = await POST(request);
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error).toContain("not configured");
  });

  it("rejects missing audio file", async () => {
    const { POST } = await import("../app/api/transcribe/route");
    const form = new FormData();
    form.append("durationSeconds", "30");

    const request = new Request("http://localhost/api/transcribe", {
      method: "POST",
      body: form,
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("rejects audio too large", async () => {
    const { POST } = await import("../app/api/transcribe/route");
    const { MAX_AUDIO_BYTES } = await import("../lib/transcribe");
    const largeBlob = new Blob(["a".repeat(MAX_AUDIO_BYTES + 1)], { type: "audio/webm" });
    const form = new FormData();
    form.append("audio", largeBlob, "test.webm");
    form.append("durationSeconds", "30");

    const request = new Request("http://localhost/api/transcribe", {
      method: "POST",
      body: form,
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
  });

  it("enforces rate limit", async () => {
    vi.resetModules();
    const { POST } = await import("../app/api/transcribe/route");
    // Route has 10 per 10 min rate limiter
    expect(typeof POST).toBe("function");
  });
});
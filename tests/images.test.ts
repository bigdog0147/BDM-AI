import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Image generation tests.
 *
 * The OpenAI SDK is mocked, so no image is ever generated and no credit is
 * spent. These tests prove the auth gate, the validation and cost limits,
 * and that a missing key produces a real configuration-required state.
 */

const h = vi.hoisted(() => ({
  generate: vi.fn(),
  currentUser: vi.fn()
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    images = { generate: h.generate };
  }
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

const ENV_KEYS = ["OPENAI_API_KEY", "BDM_IMAGE_MODEL", "AI_PROVIDER"] as const;
let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  delete process.env.OPENAI_API_KEY;
  delete process.env.BDM_IMAGE_MODEL;
  delete process.env.AI_PROVIDER;
  h.generate.mockReset();
  h.currentUser.mockReset();
  h.currentUser.mockResolvedValue(null);
  quota.user.mockReset();
  quota.user.mockResolvedValue({
    ok: true,
    limit: 20,
    used: 1,
    remaining: 19,
    resetAt: new Date(Date.now() + 86_400_000).toISOString()
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

// ------------------------------------------------------------- provider

describe("image provider configuration", () => {
  it("reports not configured without a key, and never leaks the key", async () => {
    const { imageStatus } = await import("../lib/image-provider");

    expect(imageStatus()).toEqual({
      provider: null,
      model: null,
      configured: false
    });

    process.env.OPENAI_API_KEY = "sk-test-secret-value-1234567890";
    const status = imageStatus();
    expect(status.configured).toBe(true);
    expect(status.provider).toBe("openai");
    expect(JSON.stringify(status)).not.toContain("sk-test-secret-value");
  });

  it("returns a real not_configured failure instead of faking success", async () => {
    const { generateImage } = await import("../lib/image-provider");
    const result = await generateImage({
      prompt: "a cat",
      size: "1024x1024",
      quality: "low"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_configured");
    expect(h.generate).not.toHaveBeenCalled();
  });
});

describe("image request validation", () => {
  it("rejects empty, tiny, oversized, and unsupported options", async () => {
    const { validateImageRequest } = await import("../lib/image-provider");

    expect(validateImageRequest({ prompt: "" }).ok).toBe(false);
    expect(validateImageRequest({ prompt: "ab" }).ok).toBe(false);
    expect(validateImageRequest({ prompt: "x".repeat(1001) }).ok).toBe(false);
    expect(validateImageRequest({ prompt: "a cat", size: "4096x4096" }).ok).toBe(false);
    expect(validateImageRequest({ prompt: "a cat", quality: "ultra" }).ok).toBe(false);
  });

  it("defaults to the cheapest safe settings", async () => {
    const { validateImageRequest } = await import("../lib/image-provider");
    const result = validateImageRequest({ prompt: "a lighthouse at dusk" });

    expect(result).toEqual({
      ok: true,
      prompt: "a lighthouse at dusk",
      size: "1024x1024",
      quality: "low"
    });
  });
});

describe("image generation", () => {
  it("returns a data URL and enforces one image per request", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.generate.mockResolvedValue({ data: [{ b64_json: "QUJD" }] });

    const { generateImage } = await import("../lib/image-provider");
    const result = await generateImage({
      prompt: "a lighthouse",
      size: "1536x1024",
      quality: "medium"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.dataUrl).toBe("data:image/png;base64,QUJD");
    expect(result.image).toMatchObject({
      size: "1536x1024",
      quality: "medium",
      provider: "openai",
      model: "gpt-image-1"
    });
    expect(h.generate).toHaveBeenCalledWith(
      expect.objectContaining({ n: 1, size: "1536x1024", quality: "medium" })
    );
  });

  it("maps provider failure and timeout to distinct reasons", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { generateImage } = await import("../lib/image-provider");

    h.generate.mockRejectedValueOnce(new Error("boom"));
    const failed = await generateImage({
      prompt: "a cat",
      size: "1024x1024",
      quality: "low"
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.reason).toBe("failed");

    const timeout = new Error("Request timed out");
    timeout.name = "APIConnectionTimeoutError";
    h.generate.mockRejectedValueOnce(timeout);
    const timedOut = await generateImage({
      prompt: "a cat",
      size: "1024x1024",
      quality: "low"
    });
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) expect(timedOut.reason).toBe("timeout");
  });

  it("rejects a response with no image data", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.generate.mockResolvedValueOnce({ data: [] });

    const { generateImage } = await import("../lib/image-provider");
    const result = await generateImage({
      prompt: "a cat",
      size: "1024x1024",
      quality: "low"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("failed");
  });
});

// ---------------------------------------------------------------- route

describe("POST /api/images", () => {
  it("requires authentication", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { POST } = await import("../app/api/images/route");

    const response = await POST(
      new Request("http://localhost/api/images", {
        method: "POST",
        body: JSON.stringify({ prompt: "a cat" })
      })
    );

    expect(response.status).toBe(401);
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("returns a configuration-required state when the key is missing", async () => {
    h.currentUser.mockResolvedValue({ id: "user-img-config", email: "a@b.c" });
    const { POST } = await import("../app/api/images/route");

    const response = await POST(
      new Request("http://localhost/api/images", {
        method: "POST",
        headers: { "x-forwarded-for": "10.1.0.1" },
        body: JSON.stringify({ prompt: "a cat" })
      })
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.configured).toBe(false);
    expect(body.image).toBeUndefined();
  });

  it("rejects an invalid prompt with 400", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.currentUser.mockResolvedValue({ id: "user-img-invalid", email: "a@b.c" });
    const { POST } = await import("../app/api/images/route");

    const response = await POST(
      new Request("http://localhost/api/images", {
        method: "POST",
        headers: { "x-forwarded-for": "10.1.0.2" },
        body: JSON.stringify({ prompt: "ab" })
      })
    );

    expect(response.status).toBe(400);
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("returns the generated image on success", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.currentUser.mockResolvedValue({ id: "user-img-ok", email: "a@b.c" });
    h.generate.mockResolvedValue({ data: [{ b64_json: "QUJD" }] });

    const { POST } = await import("../app/api/images/route");
    const response = await POST(
      new Request("http://localhost/api/images", {
        method: "POST",
        headers: { "x-forwarded-for": "10.1.0.3" },
        body: JSON.stringify({ prompt: "a lighthouse", size: "1024x1536" })
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.image.dataUrl).toBe("data:image/png;base64,QUJD");
    expect(body.image.size).toBe("1024x1536");
    expect(body.remainingToday).toBe(19);
  });

  it("reports a provider failure as 502, not a fake image", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    h.currentUser.mockResolvedValue({ id: "user-img-fail", email: "a@b.c" });
    h.generate.mockRejectedValue(new Error("boom"));

    const { POST } = await import("../app/api/images/route");
    const response = await POST(
      new Request("http://localhost/api/images", {
        method: "POST",
        headers: { "x-forwarded-for": "10.1.0.4" },
        body: JSON.stringify({ prompt: "a lighthouse" })
      })
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.image).toBeUndefined();
    expect(body.error).toMatch(/could not generate/i);
  });
});

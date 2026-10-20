import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Email tests.
 *
 * Resend is mocked at the fetch boundary: no message is ever sent. The suite
 * proves the opt-in switch, input validation, header-injection rejection,
 * error mapping, the explicit confirmation requirement, and quota gating.
 */

const h = vi.hoisted(() => ({
  currentUser: vi.fn(),
  quota: vi.fn(),
  reply: vi.fn()
}));

vi.mock("../lib/auth", () => ({ currentUser: h.currentUser }));

vi.mock("../lib/quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/quota")>();
  return { ...actual, consumeUserQuota: h.quota };
});

vi.mock("../lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ai")>();
  return { ...actual, generateReply: h.reply };
});

const ENV_KEYS = [
  "BDM_EMAIL_ENABLED",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "AI_PROVIDER",
  "OLLAMA_MODEL",
  "OLLAMA_API_KEY"
] as const;

let originalEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

function configureEmail(): void {
  process.env.BDM_EMAIL_ENABLED = "true";
  process.env.RESEND_API_KEY = "re_test_secret_value";
  process.env.RESEND_FROM_EMAIL = "ai@example.com";
}

function mockFetch(response: Response | (() => Promise<Response>)) {
  const fn =
    typeof response === "function"
      ? vi.fn(response)
      : vi.fn(async () => response);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  delete process.env.BDM_EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  process.env.AI_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "test-model";
  delete process.env.OLLAMA_API_KEY;

  h.currentUser.mockReset();
  h.currentUser.mockResolvedValue(null);
  h.quota.mockReset();
  h.quota.mockResolvedValue({
    ok: true,
    limit: 20,
    used: 1,
    remaining: 19,
    resetAt: new Date(Date.now() + 86_400_000).toISOString()
  });
  h.reply.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

// ------------------------------------------------------------- configuration

describe("email status", () => {
  it("stays disabled unless every requirement is present", async () => {
    const { emailStatus } = await import("../lib/email");

    expect(emailStatus().configured).toBe(false);

    process.env.RESEND_API_KEY = "re_test_secret_value";
    process.env.RESEND_FROM_EMAIL = "ai@example.com";
    // Enabled switch is still false.
    expect(emailStatus().configured).toBe(false);

    process.env.BDM_EMAIL_ENABLED = "true";
    const status = emailStatus();
    expect(status.configured).toBe(true);
    expect(status.provider).toBe("resend");
    expect(JSON.stringify(status)).not.toContain("re_test_secret_value");
  });

  it("treats only the literal true as opt-in", async () => {
    process.env.RESEND_API_KEY = "k";
    process.env.RESEND_FROM_EMAIL = "ai@example.com";
    process.env.BDM_EMAIL_ENABLED = "yes";
    const { emailStatus } = await import("../lib/email");
    expect(emailStatus().configured).toBe(false);
  });
});

// ---------------------------------------------------------------- validation

describe("email validation", () => {
  it("accepts one valid recipient", async () => {
    const { validateEmailInput } = await import("../lib/email");
    expect(
      validateEmailInput({ to: "person@example.com", subject: "Hi", body: "Hello" })
    ).toEqual({
      ok: true,
      to: "person@example.com",
      subject: "Hi",
      body: "Hello"
    });
  });

  it("rejects multiple recipients, header injection, and empty fields", async () => {
    const { validateEmailInput } = await import("../lib/email");

    expect(
      validateEmailInput({ to: "a@b.com, c@d.com", subject: "s", body: "b" })
    ).toEqual({ ok: false, reason: "too_many_recipients" });

    expect(
      validateEmailInput({ to: "a@b.com\nBcc: c@d.com", subject: "s", body: "b" })
    ).toEqual({ ok: false, reason: "bad_recipient" });

    expect(
      validateEmailInput({ to: "a@b.com", subject: "s\nBcc: c@d.com", body: "b" })
    ).toEqual({ ok: false, reason: "bad_subject" });

    expect(
      validateEmailInput({ to: "a@b.com", subject: "s", body: 42 })
    ).toEqual({ ok: false, reason: "bad_body" });

    expect(
      validateEmailInput({ to: "a@b.com", subject: "s".repeat(201), body: "b" })
    ).toEqual({ ok: false, reason: "too_long" });

    expect(
      validateEmailInput({ to: "a@b.com", subject: "s", body: "b".repeat(10_001) })
    ).toEqual({ ok: false, reason: "too_long" });
  });
});

// ------------------------------------------------------------------ provider

describe("Resend adapter", () => {
  it("does nothing and calls no endpoint when unconfigured", async () => {
    const fetchSpy = mockFetch(new Response("{}", { status: 200 }));
    const { sendEmail } = await import("../lib/email");

    const result = await sendEmail({ to: "a@b.com", subject: "s", body: "b" });
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends one message from the configured sender and returns the id", async () => {
    configureEmail();
    const fetchSpy = mockFetch(
      new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const { sendEmail } = await import("../lib/email");
    const result = await sendEmail({
      to: "person@example.com",
      subject: "Hello",
      body: "Line one\nLine two"
    });

    expect(result).toEqual({ ok: true, id: "email_123" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer re_test_secret_value"
    );
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload.from).toBe("ai@example.com");
    expect(payload.to).toEqual(["person@example.com"]);
    expect(payload.text).toContain("Line one");
    expect(payload.html).toContain("Line one<br>Line two");
  });

  it("maps provider status codes to distinct reasons", async () => {
    configureEmail();
    const { sendEmail } = await import("../lib/email");

    mockFetch(new Response("{}", { status: 401 }));
    expect(await sendEmail({ to: "a@b.com", subject: "s", body: "b" })).toEqual({
      ok: false,
      reason: "unauthorized"
    });

    mockFetch(new Response("{}", { status: 429 }));
    expect(await sendEmail({ to: "a@b.com", subject: "s", body: "b" })).toEqual({
      ok: false,
      reason: "rate_limited"
    });

    mockFetch(new Response("{}", { status: 422 }));
    expect(await sendEmail({ to: "a@b.com", subject: "s", body: "b" })).toEqual({
      ok: false,
      reason: "rejected"
    });

    mockFetch(new Response("{}", { status: 500 }));
    expect(await sendEmail({ to: "a@b.com", subject: "s", body: "b" })).toEqual({
      ok: false,
      reason: "failed"
    });
  });

  it("maps an abort to timeout", async () => {
    configureEmail();
    mockFetch(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    const { sendEmail } = await import("../lib/email");
    expect(await sendEmail({ to: "a@b.com", subject: "s", body: "b" })).toEqual({
      ok: false,
      reason: "timeout"
    });
  });
});

// ---------------------------------------------------------------- draft parse

describe("draft parsing", () => {
  it("extracts a subject and body from the requested shape", async () => {
    const { parseEmailDraft } = await import("../lib/email");

    expect(
      parseEmailDraft("Subject: Repair date\nBody:\nHello,\n\nCould we agree a date?")
    ).toEqual({
      subject: "Repair date",
      body: "Hello,\n\nCould we agree a date?"
    });
  });

  it("degrades to the whole response as the body", async () => {
    const { parseEmailDraft } = await import("../lib/email");
    const parsed = parseEmailDraft("Just a body with no headers.");
    expect(parsed.subject).toBe("Draft from BDM");
    expect(parsed.body).toBe("Just a body with no headers.");
  });

  it("collapses a multi-line subject into one line", async () => {
    const { parseEmailDraft } = await import("../lib/email");
    const parsed = parseEmailDraft("Subject: one\n two\nBody:\nbody text");
    expect(parsed.subject).toBe("one two");
    expect(parsed.subject).not.toContain("\n");
  });
});

describe("HTML rendering", () => {
  it("escapes user text", async () => {
    const { renderEmailHtml } = await import("../lib/email");
    const html = renderEmailHtml('<script>alert("x")</script> & more');

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; more");
  });
});

// ------------------------------------------------------------- send endpoint

describe("POST /api/email/send", () => {
  function request(body: unknown, ip = "10.9.0.1"): Request {
    return new Request("http://localhost/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body)
    });
  }

  it("requires authentication", async () => {
    configureEmail();
    const { POST } = await import("../app/api/email/send/route");
    const response = await POST(
      request({ to: "a@b.com", subject: "s", body: "b", confirmed: true })
    );

    expect(response.status).toBe(401);
  });

  it("refuses to send without explicit confirmation", async () => {
    configureEmail();
    h.currentUser.mockResolvedValue({ id: "user-email-noconfirm", email: "a@b.c" });
    const fetchSpy = mockFetch(new Response("{}", { status: 200 }));

    const { POST } = await import("../app/api/email/send/route");
    const response = await POST(
      request({ to: "a@b.com", subject: "s", body: "b" })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).needsConfirmation).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a real not-configured state without consuming quota", async () => {
    h.currentUser.mockResolvedValue({ id: "user-email-config", email: "a@b.c" });
    const fetchSpy = mockFetch(new Response("{}", { status: 200 }));

    const { POST } = await import("../app/api/email/send/route");
    const response = await POST(
      request({ to: "a@b.com", subject: "s", body: "b", confirmed: true })
    );

    expect(response.status).toBe(503);
    expect((await response.json()).configured).toBe(false);
    expect(h.quota).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 429 with reset information when the daily quota is spent", async () => {
    configureEmail();
    h.currentUser.mockResolvedValue({ id: "user-email-limited", email: "a@b.c" });
    const resetAt = new Date(Date.now() + 3_600_000).toISOString();
    h.quota.mockResolvedValue({ ok: false, reason: "limited", limit: 20, used: 20, resetAt });
    const fetchSpy = mockFetch(new Response("{}", { status: 200 }));

    const { POST } = await import("../app/api/email/send/route");
    const response = await POST(
      request({ to: "a@b.com", subject: "s", body: "b", confirmed: true })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect((await response.json()).resetAt).toBe(resetAt);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the quota store is unavailable", async () => {
    configureEmail();
    h.currentUser.mockResolvedValue({ id: "user-email-store", email: "a@b.c" });
    h.quota.mockResolvedValue({ ok: false, reason: "unavailable" });
    const fetchSpy = mockFetch(new Response("{}", { status: 200 }));

    const { POST } = await import("../app/api/email/send/route");
    const response = await POST(
      request({ to: "a@b.com", subject: "s", body: "b", confirmed: true })
    );

    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe("quota_unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends once and never echoes the key", async () => {
    configureEmail();
    h.currentUser.mockResolvedValue({ id: "user-email-ok", email: "a@b.c" });
    const fetchSpy = mockFetch(
      new Response(JSON.stringify({ id: "email_ok" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const { POST } = await import("../app/api/email/send/route");
    const response = await POST(
      request({
        to: "person@example.com",
        subject: "Hello",
        body: "Body",
        confirmed: true
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ sent: true, id: "email_ok", remainingToday: 19 });
    expect(JSON.stringify(body)).not.toContain("re_test_secret_value");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("maps a provider credential failure to 502", async () => {
    configureEmail();
    h.currentUser.mockResolvedValue({ id: "user-email-401", email: "a@b.c" });
    mockFetch(new Response("{}", { status: 401 }));

    const { POST } = await import("../app/api/email/send/route");
    const response = await POST(
      request({ to: "a@b.com", subject: "s", body: "b", confirmed: true })
    );

    expect(response.status).toBe(502);
    expect((await response.json()).reason).toBe("unauthorized");
  });
});

// ------------------------------------------------------------ draft endpoint

describe("POST /api/email/draft", () => {
  it("requires authentication", async () => {
    const { POST } = await import("../app/api/email/draft/route");
    const response = await POST(
      new Request("http://localhost/api/email/draft", {
        method: "POST",
        body: JSON.stringify({ instruction: "write a note" })
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects a too-short instruction", async () => {
    h.currentUser.mockResolvedValue({ id: "user-draft-short", email: "a@b.c" });
    const { POST } = await import("../app/api/email/draft/route");
    const response = await POST(
      new Request("http://localhost/api/email/draft", {
        method: "POST",
        body: JSON.stringify({ instruction: "hi" })
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns a draft and states that nothing was sent", async () => {
    h.currentUser.mockResolvedValue({ id: "user-draft-ok", email: "a@b.c" });
    h.reply.mockResolvedValue({
      text: "Subject: Repair date\nBody:\nHello,\nWhen can you visit?",
      model: "test-model",
      provider: "ollama"
    });

    const { POST } = await import("../app/api/email/draft/route");
    const response = await POST(
      new Request("http://localhost/api/email/draft", {
        method: "POST",
        body: JSON.stringify({ instruction: "Ask the landlord for a repair date" })
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sent).toBe(false);
    expect(body.draft).toBe(true);
    expect(body.subject).toBe("Repair date");
    expect(body.body).toContain("When can you visit?");
  });

  it("honours the draft quota", async () => {
    h.currentUser.mockResolvedValue({ id: "user-draft-limited", email: "a@b.c" });
    h.quota.mockResolvedValue({
      ok: false,
      reason: "limited",
      limit: 50,
      used: 50,
      resetAt: new Date(Date.now() + 3_600_000).toISOString()
    });

    const { POST } = await import("../app/api/email/draft/route");
    const response = await POST(
      new Request("http://localhost/api/email/draft", {
        method: "POST",
        body: JSON.stringify({ instruction: "Ask for a repair date" })
      })
    );

    expect(response.status).toBe(429);
    expect(h.reply).not.toHaveBeenCalled();
  });
});

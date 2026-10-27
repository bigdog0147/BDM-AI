import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Auth email tests.
 *
 * Supabase Auth is mocked: no email is requested and no token is created.
 * The suite proves the two independent budgets, generic (non-enumerating)
 * responses, Supabase-owned redirect links, and the honest degraded state
 * when the durable store is unavailable.
 */

const h = vi.hoisted(() => ({
  resend: vi.fn(),
  reset: vi.fn(),
  signUp: vi.fn(),
  shared: vi.fn()
}));

vi.mock("../lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      resend: h.resend,
      resetPasswordForEmail: h.reset,
      signUp: h.signUp
    }
  })
}));

vi.mock("../lib/quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/quota")>();
  return { ...actual, consumeSharedQuota: h.shared };
});

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
let originalEnv: Record<string, string | undefined> = {};

function okBudget() {
  return {
    ok: true,
    limit: 5,
    used: 1,
    remaining: 4,
    resetAt: new Date(Date.now() + 86_400_000).toISOString()
  };
}

function post(path: string, body: unknown, ip = "10.7.0.1"): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";

  h.resend.mockReset();
  h.resend.mockResolvedValue({ error: null });
  h.reset.mockReset();
  h.reset.mockResolvedValue({ error: null });
  h.signUp.mockReset();
  h.signUp.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.com" }, session: null }, error: null });
  h.shared.mockReset();
  h.shared.mockResolvedValue(okBudget());
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.restoreAllMocks();
});

describe("POST /api/auth/resend-verification", () => {
  it("asks Supabase to resend and returns a generic success", async () => {
    const { POST } = await import("../app/api/auth/resend-verification/route");
    const response = await POST(
      post("/api/auth/resend-verification", { email: "Person@Example.com" }, "10.7.0.2")
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, accepted: true, durable: true });
    expect(h.resend).toHaveBeenCalledTimes(1);

    const [args] = h.resend.mock.calls[0] as [
      { type: string; email: string; options: { emailRedirectTo: string } }
    ];
    expect(args.type).toBe("signup");
    expect(args.email).toBe("Person@Example.com");
    expect(args.options.emailRedirectTo).toMatch(/\/auth$/);
  });

  it("returns 400 for an invalid address", async () => {
    const { POST } = await import("../app/api/auth/resend-verification/route");
    const response = await POST(
      post("/api/auth/resend-verification", { email: "not-an-email" }, "10.7.0.3")
    );
    expect(response.status).toBe(400);
    expect(h.resend).not.toHaveBeenCalled();
  });

  it("stays generic even when Supabase reports an error", async () => {
    h.resend.mockResolvedValue({ error: { status: 400, code: "user_already_confirmed" } });
    const { POST } = await import("../app/api/auth/resend-verification/route");
    const response = await POST(
      post("/api/auth/resend-verification", { email: "a@b.com" }, "10.7.0.4")
    );

    expect(response.status).toBe(200);
    expect((await response.json()).accepted).toBe(true);
  });

  it("limits the per-address budget before the per-IP budget", async () => {
    h.shared.mockResolvedValue({
      ok: false,
      reason: "limited",
      limit: 5,
      used: 5,
      resetAt: new Date(Date.now() + 3_600_000).toISOString()
    });

    const { POST } = await import("../app/api/auth/resend-verification/route");
    const response = await POST(
      post("/api/auth/resend-verification", { email: "a@b.com" }, "10.7.0.5")
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    // Address budget was checked; the IP budget never was.
    expect(h.shared).toHaveBeenCalledTimes(1);
    expect(h.resend).not.toHaveBeenCalled();
  });

  it("applies an independent per-IP attempt limit", async () => {
    h.shared
      .mockResolvedValueOnce(okBudget())
      .mockResolvedValueOnce({
        ok: false,
        reason: "limited",
        limit: 10,
        used: 10,
        resetAt: new Date(Date.now() + 3_600_000).toISOString()
      });

    const { POST } = await import("../app/api/auth/resend-verification/route");
    const response = await POST(
      post("/api/auth/resend-verification", { email: "b@c.com" }, "10.7.0.6")
    );

    expect(response.status).toBe(429);
    expect(h.shared).toHaveBeenCalledTimes(2);
    expect(h.resend).not.toHaveBeenCalled();
  });

  it("degrades honestly to the in-process guard when the store is down", async () => {
    h.shared.mockResolvedValue({ ok: false, reason: "unavailable" });

    const { POST } = await import("../app/api/auth/resend-verification/route");
    const response = await POST(
      post("/api/auth/resend-verification", { email: "degrade@example.com" }, "10.7.0.7")
    );

    expect(response.status).toBe(200);
    expect((await response.json()).durable).toBe(false);
    expect(h.resend).toHaveBeenCalledTimes(1);
  });

  it("reports 503 when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { POST } = await import("../app/api/auth/resend-verification/route");
    const response = await POST(
      post("/api/auth/resend-verification", { email: "a@b.com" }, "10.7.0.8")
    );
    expect(response.status).toBe(503);
  });
});

describe("POST /api/auth/password-reset", () => {
  it("requests a recovery email with the reset redirect", async () => {
    const { POST } = await import("../app/api/auth/password-reset/route");
    const response = await POST(
      post("/api/auth/password-reset", { email: "a@b.com" }, "10.7.0.9")
    );

    expect(response.status).toBe(200);
    expect(h.reset).toHaveBeenCalledTimes(1);

    const [email, options] = h.reset.mock.calls[0] as [
      string,
      { redirectTo: string }
    ];
    expect(email).toBe("a@b.com");
    expect(options.redirectTo).toMatch(/\/auth\/reset$/);
  });

  it("uses a separate budget from verification emails", async () => {
    const { POST } = await import("../app/api/auth/password-reset/route");
    await POST(post("/api/auth/password-reset", { email: "a@b.com" }, "10.7.0.10"));

    const [firstSubject, firstFeature] = h.shared.mock.calls[0] as [string, string];
    expect(firstFeature).toBe("auth.reset.email");
    expect(firstSubject).toHaveLength(64);
    expect(firstSubject).not.toContain("a@b.com");
  });

  it("returns 429 when limited", async () => {
    h.shared.mockResolvedValue({
      ok: false,
      reason: "limited",
      limit: 5,
      used: 5,
      resetAt: new Date(Date.now() + 3_600_000).toISOString()
    });

    const { POST } = await import("../app/api/auth/password-reset/route");
    const response = await POST(
      post("/api/auth/password-reset", { email: "a@b.com" }, "10.7.0.11")
    );

    expect(response.status).toBe(429);
    expect(h.reset).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/signup", () => {
  it("counts the confirmation email against the verification budget", async () => {
    const { POST } = await import("../app/api/auth/signup/route");
    const response = await POST(
      post("/api/auth/signup", { email: "new@example.com", password: "longenough" }, "10.7.0.12")
    );

    expect(response.status).toBe(200);
    expect(h.signUp).toHaveBeenCalledTimes(1);

    const [, feature] = h.shared.mock.calls[0] as [string, string];
    expect(feature).toBe("auth.verify.email");
  });

  it("does not create an account when the email budget is spent", async () => {
    h.shared.mockResolvedValue({
      ok: false,
      reason: "limited",
      limit: 5,
      used: 5,
      resetAt: new Date(Date.now() + 3_600_000).toISOString()
    });

    const { POST } = await import("../app/api/auth/signup/route");
    const response = await POST(
      post("/api/auth/signup", { email: "new@example.com", password: "longenough" }, "10.7.0.13")
    );

    expect(response.status).toBe(429);
    expect(h.signUp).not.toHaveBeenCalled();
  });
});

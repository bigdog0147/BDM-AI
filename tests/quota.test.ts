import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Durable quota tests.
 *
 * Supabase is mocked: no database is touched. The tests cover window math,
 * environment parsing, the success/limited/unavailable mapping, and the
 * guarantee that a missing migration fails closed instead of allowing a
 * paid call.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn()
}));

vi.mock("../lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: (...args: unknown[]) => h.rpc(...args)
  })
}));

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "BDM_QUOTA_IMAGE_DAILY"
] as const;

let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";
  delete process.env.BDM_QUOTA_IMAGE_DAILY;
  h.rpc.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.restoreAllMocks();
});

describe("quota windows", () => {
  it("floors to UTC day, hour, and ten-minute boundaries", async () => {
    const { windowStartFor, windowResetFor } = await import("../lib/quota");
    const now = new Date("2026-10-20T13:37:42.123Z");

    expect(windowStartFor("day", now).toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(windowStartFor("hour", now).toISOString()).toBe("2026-10-20T13:00:00.000Z");
    expect(windowStartFor("tenMinutes", now).toISOString()).toBe(
      "2026-10-20T13:30:00.000Z"
    );

    expect(windowResetFor("day", windowStartFor("day", now)).toISOString()).toBe(
      "2026-10-21T00:00:00.000Z"
    );
    expect(windowResetFor("hour", windowStartFor("hour", now)).toISOString()).toBe(
      "2026-10-20T14:00:00.000Z"
    );
  });
});

describe("limit configuration", () => {
  it("uses the default when unset or invalid, and clamps absurd values", async () => {
    const { readLimit } = await import("../lib/quota");

    expect(readLimit("BDM_QUOTA_IMAGE_DAILY", 20)).toBe(20);
    process.env.BDM_QUOTA_IMAGE_DAILY = "7";
    expect(readLimit("BDM_QUOTA_IMAGE_DAILY", 20)).toBe(7);
    process.env.BDM_QUOTA_IMAGE_DAILY = "-3";
    expect(readLimit("BDM_QUOTA_IMAGE_DAILY", 20)).toBe(20);
    process.env.BDM_QUOTA_IMAGE_DAILY = "not-a-number";
    expect(readLimit("BDM_QUOTA_IMAGE_DAILY", 20)).toBe(20);
    process.env.BDM_QUOTA_IMAGE_DAILY = "999999999";
    expect(readLimit("BDM_QUOTA_IMAGE_DAILY", 20)).toBe(100_000);
  });

  it("reports the configured limits without revealing secrets", async () => {
    const { quotaStatus } = await import("../lib/quota");
    const status = quotaStatus();

    expect(status.store).toBe("database");
    expect(status.migration).toContain("0002_usage_quotas.sql");
    expect(status.migrationState).toBe("unknown");
    expect(status.limits.imageDaily).toBeGreaterThan(0);
    expect(JSON.stringify(status)).not.toContain("test-key");
  });

  it("does not claim a durable store when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const { quotaStatus } = await import("../lib/quota");
    expect(quotaStatus().store).toBe("not_configured");
  });
});

describe("user quota", () => {
  const resetAt = "2026-10-21T00:00:00.000Z";

  it("returns the remaining allowance when the slot is available", async () => {
    h.rpc.mockResolvedValue({
      data: [{ allowed: true, used: 3, remaining: 17, reset_at: resetAt }],
      error: null
    });

    const { consumeUserQuota } = await import("../lib/quota");
    const outcome = await consumeUserQuota("image.daily", "day", 20);

    expect(outcome).toEqual({
      ok: true,
      limit: 20,
      used: 3,
      remaining: 17,
      resetAt
    });

    const [fn, args] = h.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("bdm_consume_user_quota");
    expect(args.p_feature).toBe("image.daily");
    expect(args.p_limit).toBe(20);
  });

  it("returns a limited decision with the reset time", async () => {
    h.rpc.mockResolvedValue({
      data: [{ allowed: false, used: 20, remaining: 0, reset_at: resetAt }],
      error: null
    });

    const { consumeUserQuota } = await import("../lib/quota");
    const outcome = await consumeUserQuota("image.daily", "day", 20);

    expect(outcome).toEqual({
      ok: false,
      reason: "limited",
      limit: 20,
      used: 20,
      resetAt
    });
  });

  it("fails closed when the migration is missing", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.bdm_consume_user_quota"
      }
    });

    const { consumeUserQuota } = await import("../lib/quota");
    const outcome = await consumeUserQuota("image.daily", "day", 20);

    expect(outcome).toEqual({ ok: false, reason: "unavailable" });
  });

  it("fails closed without Supabase configuration", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const { consumeUserQuota } = await import("../lib/quota");
    const outcome = await consumeUserQuota("image.daily", "day", 20);

    expect(outcome).toEqual({ ok: false, reason: "unavailable" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("treats a zero limit as limited without calling the database", async () => {
    const { consumeUserQuota } = await import("../lib/quota");
    const outcome = await consumeUserQuota("image.daily", "day", 0);

    expect(outcome).toMatchObject({ ok: false, reason: "limited", limit: 0 });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("shared quota", () => {
  it("hashes are stable and do not contain the raw subject", async () => {
    const { hashSubject } = await import("../lib/auth-email");
    const a = hashSubject("email:person@example.com");
    const b = hashSubject("EMAIL:person@example.com");

    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).not.toContain("person");
  });

  it("delegates to the shared function with the hashed subject", async () => {
    h.rpc.mockResolvedValue({
      data: [{ allowed: true, used: 1, remaining: 4, reset_at: "2026-10-21T00:00:00.000Z" }],
      error: null
    });

    const { consumeSharedQuota } = await import("../lib/quota");
    const outcome = await consumeSharedQuota("abc123", "auth.verify.email", "day", 5);

    expect(outcome.ok).toBe(true);
    const [fn, args] = h.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("bdm_consume_shared_quota");
    expect(args.p_subject).toBe("abc123");
  });
});

describe("retry-after", () => {
  it("is at least one second and reflects the reset time", async () => {
    const { retryAfterSeconds } = await import("../lib/quota");

    expect(retryAfterSeconds(new Date(Date.now() - 1000).toISOString())).toBe(1);
    expect(retryAfterSeconds(new Date(Date.now() + 90_000).toISOString())).toBeGreaterThan(80);
    expect(retryAfterSeconds("not-a-date")).toBe(60);
  });
});

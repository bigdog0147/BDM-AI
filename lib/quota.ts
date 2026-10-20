import { createSupabaseServerClient } from "./supabase-server";

/**
 * Durable usage quotas.
 *
 * Counters live in Supabase (`bdm_usage_counters`) and are incremented by an
 * atomic SECURITY DEFINER function, so the limit holds across restarts and
 * across multiple Render instances. In-process limiting is kept only as a
 * secondary burst guard; it is never the production control.
 *
 * Failure policy: paid features fail closed. If the quota store is missing
 * (migration not applied) or unreachable, the caller gets
 * `reason: "unavailable"` and must not call the paid provider.
 */

export type QuotaWindow = "tenMinutes" | "hour" | "day";

const WINDOW_MS: Record<QuotaWindow, number> = {
  tenMinutes: 10 * 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000
};

export function windowStartFor(window: QuotaWindow, now = new Date()): Date {
  return new Date(Math.floor(now.getTime() / WINDOW_MS[window]) * WINDOW_MS[window]);
}

export function windowResetFor(window: QuotaWindow, start: Date): Date {
  return new Date(start.getTime() + WINDOW_MS[window]);
}

/** Parse a limit from the environment, falling back when absent or invalid. */
export function readLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), 100_000);
}

export interface QuotaLimits {
  imageDaily: number;
  imageBurst: number;
  transcribeDaily: number;
  transcribeBurst: number;
  researchDaily: number;
  researchBurst: number;
  emailDaily: number;
  emailDraftDaily: number;
  verifyEmailDaily: number;
  verifyAttemptHourly: number;
  resetEmailDaily: number;
  resetAttemptHourly: number;
}

/**
 * Configured limits, read on every call so a restart-free env change is
 * reflected immediately. Defaults are deliberately small: they are abuse
 * ceilings, not product targets.
 */
export function quotaLimits(): QuotaLimits {
  return {
    imageDaily: readLimit("BDM_QUOTA_IMAGE_DAILY", 20),
    imageBurst: readLimit("BDM_QUOTA_IMAGE_BURST", 5),
    transcribeDaily: readLimit("BDM_QUOTA_TRANSCRIBE_DAILY", 50),
    transcribeBurst: readLimit("BDM_QUOTA_TRANSCRIBE_BURST", 10),
    researchDaily: readLimit("BDM_QUOTA_RESEARCH_DAILY", 40),
    researchBurst: readLimit("BDM_QUOTA_RESEARCH_BURST", 10),
    emailDaily: readLimit("BDM_QUOTA_EMAIL_DAILY", 20),
    emailDraftDaily: readLimit("BDM_QUOTA_EMAIL_DRAFT_DAILY", 50),
    verifyEmailDaily: readLimit("BDM_QUOTA_VERIFY_EMAIL_DAILY", 5),
    verifyAttemptHourly: readLimit("BDM_QUOTA_VERIFY_ATTEMPT_HOURLY", 10),
    resetEmailDaily: readLimit("BDM_QUOTA_RESET_EMAIL_DAILY", 5),
    resetAttemptHourly: readLimit("BDM_QUOTA_RESET_ATTEMPT_HOURLY", 10)
  };
}

export type QuotaOutcome =
  | {
      ok: true;
      limit: number;
      used: number;
      remaining: number;
      resetAt: string;
    }
  | {
      ok: false;
      reason: "limited";
      limit: number;
      used: number;
      resetAt: string;
    }
  | { ok: false; reason: "unavailable" };

interface RpcRow {
  allowed?: unknown;
  used?: unknown;
  remaining?: unknown;
  reset_at?: unknown;
}

function normalize(
  data: unknown,
  limit: number,
  fallbackResetAt: string
): QuotaOutcome {
  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;
  if (!row || typeof row.allowed !== "boolean") {
    return { ok: false, reason: "unavailable" };
  }
  const used = typeof row.used === "number" ? row.used : 0;
  const remaining =
    typeof row.remaining === "number" ? Math.max(0, row.remaining) : 0;
  const resetAt =
    typeof row.reset_at === "string" ? row.reset_at : fallbackResetAt;

  if (!row.allowed) {
    return { ok: false, reason: "limited", limit, used, resetAt };
  }
  return { ok: true, limit, used, remaining, resetAt };
}

function isMissingFunction(message: string | undefined): boolean {
  if (!message) return false;
  return (
    message.includes("Could not find the function") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

function hasSupabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

/**
 * Consume one unit of an authenticated user's quota.
 *
 * `feature` is stored verbatim and validated by the database function, so it
 * must be a short lowercase key such as `image.daily`.
 */
export async function consumeUserQuota(
  feature: string,
  window: QuotaWindow,
  limit: number
): Promise<QuotaOutcome> {
  const start = windowStartFor(window);
  const reset = windowResetFor(window, start).toISOString();

  if (!Number.isFinite(limit) || limit <= 0) {
    return { ok: false, reason: "limited", limit: 0, used: 0, resetAt: reset };
  }
  if (!hasSupabase()) return { ok: false, reason: "unavailable" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("bdm_consume_user_quota", {
      p_feature: feature,
      p_window_start: start.toISOString(),
      p_reset_at: reset,
      p_limit: limit
    });

    if (error) {
      // A missing migration is a configuration state, not a user error.
      console.error(
        "BDM quota: user counter failed",
        isMissingFunction(error.message) ? "migration missing" : error.code
      );
      return { ok: false, reason: "unavailable" };
    }

    return normalize(data, limit, reset);
  } catch (error) {
    console.error("BDM quota: user counter threw", error instanceof Error ? error.name : "unknown");
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Consume one unit of a shared quota, keyed by a server-computed, hashed
 * subject. Used only for unauthenticated email throttling.
 */
export async function consumeSharedQuota(
  subject: string,
  feature: string,
  window: QuotaWindow,
  limit: number
): Promise<QuotaOutcome> {
  const start = windowStartFor(window);
  const reset = windowResetFor(window, start).toISOString();

  if (!Number.isFinite(limit) || limit <= 0) {
    return { ok: false, reason: "limited", limit: 0, used: 0, resetAt: reset };
  }
  if (!hasSupabase() || !subject) return { ok: false, reason: "unavailable" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("bdm_consume_shared_quota", {
      p_subject: subject,
      p_feature: feature,
      p_window_start: start.toISOString(),
      p_reset_at: reset,
      p_limit: limit
    });

    if (error) {
      console.error(
        "BDM quota: shared counter failed",
        isMissingFunction(error.message) ? "migration missing" : error.code
      );
      return { ok: false, reason: "unavailable" };
    }

    return normalize(data, limit, reset);
  } catch (error) {
    console.error("BDM quota: shared counter threw", error instanceof Error ? error.name : "unknown");
    return { ok: false, reason: "unavailable" };
  }
}

/** Seconds until a quota window resets, floored at 1 for Retry-After. */
export function retryAfterSeconds(resetAt: string): number {
  const reset = Date.parse(resetAt);
  if (!Number.isFinite(reset)) return 60;
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

/**
 * Redacted quota configuration for /api/status. No database call, so the
 * status endpoint stays cheap and never fails because of a quota outage.
 */
export function quotaStatus(): {
  store: "database" | "not_configured";
  migration: string;
  migrationState: "unknown";
  limits: QuotaLimits;
  windows: Record<string, string>;
} {
  return {
    // This is the store the code is configured to use, not proof that it is
    // reachable. Endpoints fail closed with `quota_unavailable` until the
    // migration below has been applied.
    store: hasSupabase() ? "database" : "not_configured",
    migration: "supabase/migrations/0002_usage_quotas.sql",
    // /api/status makes no database call, so it cannot confirm that the
    // migration has been applied. Do not turn this into a false "applied".
    migrationState: "unknown",
    limits: quotaLimits(),
    windows: {
      burst: "10 minutes (in-process guard)",
      image: "UTC day",
      transcribe: "UTC day",
      research: "UTC day",
      email: "UTC day",
      authEmail: "UTC day per address"
    }
  };
}

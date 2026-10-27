import { createHash } from "node:crypto";
import {
  consumeSharedQuota,
  quotaLimits,
  retryAfterSeconds,
  windowResetFor,
  windowStartFor,
  type QuotaWindow
} from "./quota";
import { createRateLimiter, requestKey, type RateLimiter } from "./rate-limit";

/**
 * Throttling for the auth emails this app can trigger.
 *
 * Supabase Auth owns the actual confirmation and recovery tokens; this module
 * only limits how often *we ask Supabase* to send an email. Two independent
 * budgets are enforced, both keyed by a SHA-256 hash so no raw address is
 * stored:
 *
 *   - per address, per UTC day  (verify-email / reset-email)
 *   - per IP, per hour          (verify-attempt / reset-attempt)
 *
 * The counters are database-backed when the quota migration is present. If
 * the store is unavailable, the route still works but degrades to the
 * in-process limiter plus Supabase's own mailer rate limits; the response
 * reports `durable: false` so the caller never pretends otherwise.
 */

export type AuthEmailKind = "verify" | "reset";

export interface AuthEmailBudgetOk {
  ok: true;
  durable: boolean;
}

export interface AuthEmailBudgetLimited {
  ok: false;
  reason: "limited";
  durable: boolean;
  resetAt: string;
  retryAfterSeconds: number;
}

export type AuthEmailBudget = AuthEmailBudgetOk | AuthEmailBudgetLimited;

export function hashSubject(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

const fallbackLimiters = new Map<string, RateLimiter>();

function fallbackLimiter(key: string, windowMs: number, max: number): RateLimiter {
  const id = `${key}:${windowMs}:${max}`;
  const existing = fallbackLimiters.get(id);
  if (existing) return existing;
  const created = createRateLimiter({ windowMs, max });
  fallbackLimiters.set(id, created);
  return created;
}

function limitsFor(kind: AuthEmailKind): {
  emailLimit: number;
  attemptLimit: number;
} {
  const limits = quotaLimits();
  return kind === "verify"
    ? { emailLimit: limits.verifyEmailDaily, attemptLimit: limits.verifyAttemptHourly }
    : { emailLimit: limits.resetEmailDaily, attemptLimit: limits.resetAttemptHourly };
}

interface BudgetCheck {
  allowed: boolean;
  resetAt: string;
  durable: boolean;
}

async function checkOne(
  subject: string,
  feature: string,
  window: QuotaWindow,
  limit: number,
  durable: boolean
): Promise<BudgetCheck> {
  if (durable) {
    const outcome = await consumeSharedQuota(subject, feature, window, limit);
    if (outcome.ok) {
      return { allowed: true, resetAt: outcome.resetAt, durable: true };
    }
    if (outcome.reason === "limited") {
      return { allowed: false, resetAt: outcome.resetAt, durable: true };
    }
  }

  // Fallback: in-process only. Never reached when the store is healthy.
  const start = windowStartFor(window);
  const resetAt = windowResetFor(window, start).toISOString();
  const decision = fallbackLimiter(feature, resetAtMs(window), limit).check(subject);
  return { allowed: !decision.limited, resetAt, durable: false };
}

function resetAtMs(window: QuotaWindow): number {
  return window === "day" ? 24 * 60 * 60_000 : 60 * 60_000;
}

/**
 * Check both budgets for an auth email.
 *
 * The address budget is consumed first so a blocked IP cannot burn an
 * address's daily allowance without that being counted.
 */
export async function checkAuthEmailBudget(input: {
  request: Request;
  email: string;
  kind: AuthEmailKind;
}): Promise<AuthEmailBudget> {
  const { emailLimit, attemptLimit } = limitsFor(input.kind);
  const durable = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );

  const addressSubject = hashSubject(`email:${input.email.trim().toLowerCase()}`);
  const ip = requestKey(input.request);
  const ipSubject = hashSubject(`ip:${ip}`);

  const address = await checkOne(
    addressSubject,
    `auth.${input.kind}.email`,
    "day",
    emailLimit,
    durable
  );
  if (!address.allowed) {
    return {
      ok: false,
      reason: "limited",
      durable: address.durable,
      resetAt: address.resetAt,
      retryAfterSeconds: retryAfterSeconds(address.resetAt)
    };
  }

  const attempt = await checkOne(
    ipSubject,
    `auth.${input.kind}.attempt`,
    "hour",
    attemptLimit,
    durable
  );
  if (!attempt.allowed) {
    return {
      ok: false,
      reason: "limited",
      durable: attempt.durable,
      resetAt: attempt.resetAt,
      retryAfterSeconds: retryAfterSeconds(attempt.resetAt)
    };
  }

  return { ok: true, durable: address.durable && attempt.durable };
}

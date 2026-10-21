/**
 * Minimal in-process rate limiter.
 *
 * Single-instance only: a multi-instance deployment needs a shared store.
 * Still meaningfully bounds accidental loops and abuse on one server, and
 * keeps paid provider calls from being fired in a tight loop.
 */

export interface RateLimitDecision {
  limited: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
}): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateLimitDecision {
      const now = Date.now();
      const cutoff = now - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((time) => time > cutoff);
      recent.push(now);
      hits.set(key, recent);

      // Opportunistic cleanup so the map cannot grow without bound.
      if (hits.size > 1000) {
        for (const [entryKey, times] of hits) {
          if (times.every((time) => time <= cutoff)) hits.delete(entryKey);
        }
      }

      const limited = recent.length > options.max;
      const oldest = recent[0] ?? now;
      return {
        limited,
        remaining: Math.max(0, options.max - recent.length),
        retryAfterSeconds: limited
          ? Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000))
          : 0
      };
    }
  };
}

/** Client identity for rate-limit bucketing, without trusting client headers. */
export function requestKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

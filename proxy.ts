import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * BDM AI Web Application Firewall (WAF) & Supabase Session Proxy.
 *
 * 1. Blocks exploit probes (path traversal, SQLi/XSS query patterns, dotfile/.env scanners).
 * 2. Hard-blocks `/dev-monitor` and `/api/dev-monitor/*` in production.
 * 3. Enforces per-IP sliding-window rate limiting on `/api/*` endpoints.
 * 4. Attaches strict security & anti-clickjacking headers on all responses.
 * 5. Refreshes the Supabase httpOnly cookie session.
 */

const RATE_WINDOW_MS = 60_000;
const MAX_API_REQUESTS_PER_WINDOW = 120;
const MAX_AUTH_REQUESTS_PER_WINDOW = 30;

const ipBuckets = new Map<string, { count: number; resetAt: number }>();

const BLOCKED_PATH_PATTERNS = [
  /(?:^|\/)\.(?:env|git|svn|hg|DS_Store|htaccess|htpasswd)(?:\/|$|\.)/i,
  /(?:^|\/)(?:wp-admin|wp-login|phpmyadmin|cgi-bin|vendor\/phpunit|actuator)(?:\/|$)/i,
  /\.\.(\/|\\|%2f|%5c)/i
];

const BLOCKED_QUERY_PATTERNS = [
  /(?:<script\b|javascript:|onerror\s*=|onload\s*=)/i,
  /(?:\bunion\s+select\b|\bdrop\s+table\b|--\s*$|;\s*shutdown\b)/i
];

function extractClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "local";
}

function checkRateLimit(key: string, limit: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  if (ipBuckets.size > 5000) {
    for (const [k, v] of ipBuckets.entries()) {
      if (v.resetAt <= now) ipBuckets.delete(k);
    }
  }
  const slot = ipBuckets.get(key);
  if (!slot || slot.resetAt <= now) {
    ipBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  slot.count += 1;
  if (slot.count > limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((slot.resetAt - now) / 1000))
    };
  }
  return { allowed: true, retryAfter: 0 };
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), payment=(), usb=(), magnetometer=()"
  );
  response.headers.set("X-BDM-Firewall", "active");
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl?.pathname ?? new URL(request.url).pathname;
  const search = request.nextUrl?.search ?? new URL(request.url).search;

  // 1. Block dev-monitor surfaces in production
  if (
    process.env.NODE_ENV === "production" &&
    (pathname === "/dev-monitor" ||
      pathname.startsWith("/dev-monitor/") ||
      pathname.startsWith("/api/dev-monitor"))
  ) {
    return applySecurityHeaders(
      NextResponse.json({ error: "Not found" }, { status: 404 })
    );
  }

  // 2. WAF signature inspection on path & query string
  const decodedPath = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  })();

  if (
    BLOCKED_PATH_PATTERNS.some((rx) => rx.test(pathname) || rx.test(decodedPath)) ||
    (search && BLOCKED_QUERY_PATTERNS.some((rx) => rx.test(search)))
  ) {
    return applySecurityHeaders(
      NextResponse.json(
        { error: "Blocked by BDM Application Firewall" },
        { status: 403 }
      )
    );
  }

  // 3. Per-IP burst rate limiting on API and Auth endpoints
  if (pathname.startsWith("/api/")) {
    const ip = extractClientIp(request);
    const isAuthRoute = pathname.startsWith("/api/auth/");
    const bucketKey = `${ip}:${isAuthRoute ? "auth" : "api"}`;
    const limit = isAuthRoute ? MAX_AUTH_REQUESTS_PER_WINDOW : MAX_API_REQUESTS_PER_WINDOW;
    const rate = checkRateLimit(bucketKey, limit);
    if (!rate.allowed) {
      const blocked = NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429 }
      );
      blocked.headers.set("Retry-After", String(rate.retryAfter));
      return applySecurityHeaders(blocked);
    }
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase is not configured, pass through with firewall headers intact.
  if (!url || !key) {
    return applySecurityHeaders(response);
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      }
    }
  });

  // Touch the session so expired tokens are refreshed and cookies updated.
  await supabase.auth.getUser();

  return applySecurityHeaders(response);
}

export const config = {
  matcher: [
    // Run on everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};

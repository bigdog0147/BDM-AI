import { notFound } from "next/navigation";

import { currentUser } from "./auth";
import { isDevMonitorEnabled, isLoopbackHost, sameOriginRequest } from "./dev-monitor";

export async function assertDevMonitorAccess(request?: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  if (process.env.NODE_ENV !== "development") return { ok: false, response: new Response(null, { status: 404 }) };
  if (!isDevMonitorEnabled()) return { ok: false, response: new Response(null, { status: 404 }) };

  if (request) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (!isLoopbackHost(host)) return { ok: false, response: new Response(null, { status: 404 }) };
    if (request.method !== "GET" && request.method !== "HEAD" && !sameOriginRequest(request)) {
      return { ok: false, response: new Response(JSON.stringify({ error: "invalid origin" }), { headers: { "content-type": "application/json" }, status: 403 }) };
    }
  }

  const user = await currentUser();
  if (!user) return { ok: false, response: new Response(JSON.stringify({ error: "authentication required" }), { headers: { "content-type": "application/json" }, status: 401 }) };
  return { ok: true, userId: user.id };
}

export async function devMonitorGuardOr404(request?: Request): Promise<{ userId: string } | null> {
  const verdict = await assertDevMonitorAccess(request);
  if (!verdict.ok) return null;
  return { userId: verdict.userId };
}

export async function devMonitorPageGuard(request?: Request): Promise<{ userId: string } | null> {
  const verdict = await assertDevMonitorAccess(request);
  if (!verdict.ok) return null;
  return { userId: verdict.userId };
}

export function devMonitorNotFound(): never {
  notFound();
}

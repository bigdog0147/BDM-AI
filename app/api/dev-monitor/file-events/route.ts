import { NextResponse } from "next/server";

import { devMonitorPageGuard } from "../../../../lib/dev-monitor-guard";
import { getRecentFileEvents, getWatcherState, recordFileEvent } from "../../../../lib/dev-monitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = await devMonitorPageGuard(request);
  if (!access) return new Response(null, { status: 404 });
  return NextResponse.json({ events: getRecentFileEvents(100), watcher: getWatcherState() });
}

export async function POST(request: Request): Promise<Response> {
  const access = await devMonitorPageGuard(request);
  if (!access) return new Response(null, { status: 404 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }
  const eventPayload = payload as { relativePath?: unknown; source?: unknown; type?: unknown };
  if (typeof eventPayload.relativePath !== "string" || typeof eventPayload.type !== "string") {
    return NextResponse.json({ error: "missing event fields" }, { status: 400 });
  }

  const trustedSource =
    eventPayload.source === "opencode_reported" ? "opencode_reported" :
    eventPayload.source === "user_reported" ? "user_reported" : "unknown";

  const permittedType = eventPayload.type === "create" || eventPayload.type === "modify" || eventPayload.type === "delete";
  if (!permittedType) {
    return NextResponse.json({ error: "invalid event type" }, { status: 400 });
  }

  const event = recordFileEvent({
    relativePath: eventPayload.relativePath,
    source: trustedSource as "filesystem_observed" | "user_reported" | "opencode_reported" | "unknown",
    type: eventPayload.type as "create" | "modify" | "delete"
  });
  return NextResponse.json({ event });
}

import { NextResponse } from "next/server";

import { devMonitorPageGuard } from "../../../../lib/dev-monitor-guard";
import { getAuditEvents } from "../../../../lib/audit";
import type { Task } from "../../../../lib/bdm-types";
import { listTasks } from "../../../../lib/task-executor";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = await devMonitorPageGuard(request);
  if (!access) return new Response(null, { status: 404 });

  const tasks = await listTasks(access.userId, { limit: 100 });
  const events = await getAuditEvents(access.userId, { limit: 50 });

  return NextResponse.json({
    approvals: tasks.filter((task: Task) => task.status === "awaiting_approval"),
    audits: events
      .filter((event: { event_type: string }) => event.event_type === "task" || event.event_type === "system")
      .map((event: { action: string; id: string; status: string; created_at: string; tool_key?: string | null }) => ({
        action: event.action,
        id: event.id,
        status: event.status,
        timestamp: event.created_at,
        tool: event.tool_key
      })),
    completed: tasks.filter((task: Task) => task.status === "completed"),
    failed: tasks.filter((task: Task) => task.status === "failed"),
    pending: tasks.filter((task: Task) => task.status === "queued" || task.status === "planning"),
    running: tasks.filter((task: Task) => task.status === "running")
  });
}

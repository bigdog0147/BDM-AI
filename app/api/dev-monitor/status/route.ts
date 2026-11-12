import { NextResponse } from "next/server";

import { currentUser } from "../../../../lib/auth";
import { getAuditEvents } from "../../../../lib/audit";
import type { Task } from "../../../../lib/bdm-types";
import { listTasks } from "../../../../lib/task-executor";
import { devMonitorPageGuard } from "../../../../lib/dev-monitor-guard";
import { getLatestValidationReport, getWatcherState, safeGitDiffStat, safeGitSummary } from "../../../../lib/dev-monitor";

export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  const access = await devMonitorPageGuard(request);
  if (!access) {
    return new Response(null, { status: 404 });
  }

  const git = safeGitSummary();
  const watcher = getWatcherState();
  // Watcher is safe to start in dev only when requested through this API.
  if (!watcher.active) {
    try {
      const { startFileWatcher } = await import("../../../../lib/dev-monitor");
      startFileWatcher();
    } catch {
      // Ignore and leave status reporting in failed state.
    }
  }

  const user = await currentUser();
  const tasks = user ? await listTasks(user.id, { limit: 50 }) : [];
  const events = user ? await getAuditEvents(user.id, { limit: 20 }) : [];

  const grouped = {
    completed: tasks.filter((task: Task) => task.status === "completed").length,
    failed: tasks.filter((task: Task) => task.status === "failed").length,
    pending: tasks.filter((task: Task) => task.status === "queued").length,
    running: tasks.filter((task: Task) => task.status === "running").length
  };

  return NextResponse.json({
    git,
    gitDiffStat: redactString(safeGitDiffStat()),
    lastReport: getLatestValidationReport(),
    monitorEnabled: process.env.BDM_DEV_MONITOR_ENABLED === "true",
    regulatedAudits: events.slice(0, 12).map((event: { action: string; id: string; status: string; created_at: string; tool_key?: string | null }) => ({
      action: event.action,
      id: event.id,
      status: event.status,
      timestamp: event.created_at,
      tool: event.tool_key
    })),
    safe: true,
    tasks: grouped,
    timestamp: new Date().toISOString(),
    watcher: {
      active: getWatcherState().active,
      error: getWatcherState().error,
      events: getWatcherState().events.slice(0, 50)
    }
  });
}

function redactString(value: string): string {
  return value;
}

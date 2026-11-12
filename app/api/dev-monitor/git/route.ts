import { NextResponse } from "next/server";

import { devMonitorPageGuard } from "../../../../lib/dev-monitor-guard";
import { safeGitDiffNames, safeGitDiffStat, safeGitSummary } from "../../../../lib/dev-monitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = await devMonitorPageGuard(request);
  if (!access) return new Response(null, { status: 404 });
  return NextResponse.json({
    added: safeGitSummary().added,
    deleted: safeGitSummary().deleted,
    files: safeGitDiffNames(),
    modified: safeGitSummary().modified,
    stat: safeGitDiffStat()
  });
}

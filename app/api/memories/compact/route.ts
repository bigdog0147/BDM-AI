import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/auth";
import { isMemoryKind } from "../../../../lib/memory-core";
import { previewCompaction, executeCompaction } from "../../../../lib/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/memories/compact
 * Body: { project?: string, execute?: boolean, summaryContent?: string, supersededIds?: string[], kind?: string }
 *
 * Without execute: returns a preview of what would be compacted.
 * With execute=true: performs the compaction (requires summaryContent and supersededIds from preview).
 */
export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as {
    project?: unknown;
    execute?: unknown;
    summaryContent?: unknown;
    supersededIds?: unknown;
    kind?: unknown;
  } | null;

  const project =
    typeof payload?.project === "string" && payload.project.trim()
      ? payload.project.trim().slice(0, 100)
      : null;
  const execute = payload?.execute === true;
  const kind = isMemoryKind(payload?.kind) ? payload.kind : "summary";

  if (!execute) {
    // Preview mode
    const preview = await previewCompaction(user.id, { project });
    if (!preview) {
      return NextResponse.json({
        preview: null,
        message: "Not enough memories to compact (need ≥3 older, low-importance, unpinned memories)"
      });
    }
    return NextResponse.json({ preview });
  }

  // Execute mode
  const summaryContent = typeof payload?.summaryContent === "string" ? payload.summaryContent : "";
  const supersededIds = Array.isArray(payload?.supersededIds)
    ? payload.supersededIds.filter((id): id is string => typeof id === "string")
    : [];

  if (!summaryContent || supersededIds.length === 0) {
    return NextResponse.json(
      { error: "execute=true requires summaryContent and supersededIds from preview" },
      { status: 400 }
    );
  }

  const result = await executeCompaction(user.id, summaryContent, supersededIds, { project, kind });

  if (!result.ok) {
    const statusCode = result.reason === "unavailable" ? 503 : 400;
    return NextResponse.json({ error: "Could not execute compaction" }, { status: statusCode });
  }

  return NextResponse.json({
    summaryMemory: result.summaryMemory,
    supersededCount: result.supersededCount
  });
}
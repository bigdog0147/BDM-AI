import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/auth";
import { scanDuplicates } from "../../../../lib/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/memories/deduplicate
 * Body: { project?: string }
 * Returns proposed duplicate groups for user approval.
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

  const payload = body as { project?: unknown } | null;
  const project =
    typeof payload?.project === "string" && payload.project.trim()
      ? payload.project.trim().slice(0, 100)
      : null;

  const result = await scanDuplicates(user.id, { project });

  // Convert Map to plain object for JSON serialization
  const memoriesObj: Record<string, unknown> = {};
  for (const [id, memory] of result.memories) {
    memoriesObj[id] = memory;
  }

  return NextResponse.json({
    groups: result.groups,
    memories: memoriesObj,
    count: result.groups.length
  });
}
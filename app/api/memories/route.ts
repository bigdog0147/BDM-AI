import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth";
import { isMemoryKind, containsSecret } from "../../../lib/memory-core";
import {
  clearMemories,
  listMemories,
  saveMemory
} from "../../../lib/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTENT = 4000;

/** List or search the signed-in user's long-term memories. */
export async function GET(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || undefined;
  const project = url.searchParams.get("project")?.trim() || null;

  const memories = await listMemories(user.id, { query, project });
  return NextResponse.json({ memories, count: memories.length });
}

/** Create a memory explicitly. Inference is never auto-saved here. */
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

  const payload = body as
    | {
        content?: unknown;
        kind?: unknown;
        importance?: unknown;
        project?: unknown;
        pinned?: unknown;
        conversationId?: unknown;
      }
    | null;

  const content = typeof payload?.content === "string" ? payload.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT) {
    return NextResponse.json({ error: "content is too long" }, { status: 413 });
  }
  if (containsSecret(content)) {
    return NextResponse.json(
      { error: "Secrets and credentials are never stored in memory" },
      { status: 422 }
    );
  }

  const project =
    typeof payload?.project === "string" && payload.project.trim()
      ? payload.project.trim().slice(0, 100)
      : null;

  const result = await saveMemory({
    userId: user.id,
    content,
    kind: isMemoryKind(payload?.kind) ? payload.kind : undefined,
    importance:
      typeof payload?.importance === "number" ? payload.importance : undefined,
    project,
    pinned: payload?.pinned === true,
    sourceConversationId:
      typeof payload?.conversationId === "string" ? payload.conversationId : null
  });

  if (!result.ok) {
    const status = result.reason === "secret" ? 422 : result.reason === "unavailable" ? 503 : 500;
    const error =
      result.reason === "secret"
        ? "Secrets and credentials are never stored in memory"
        : result.reason === "unavailable"
          ? "Memory storage is unavailable"
          : "Could not save memory";
    return NextResponse.json({ error }, { status });
  }

  return NextResponse.json({ memory: result.memory }, { status: 201 });
}

/**
 * Clear memories. With ?project=... only that project's scoped memories are
 * removed; unscoped (global) memories and other projects are untouched.
 */
export async function DELETE(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const url = new URL(request.url);
  const project = url.searchParams.get("project")?.trim() || null;
  const deleted = await clearMemories(user.id, { project });

  return NextResponse.json({ deleted });
}

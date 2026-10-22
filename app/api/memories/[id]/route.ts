import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/auth";
import { containsSecret, isMemoryKind, isMemorySource, isValidationStatus } from "../../../../lib/memory-core";
import { deleteMemory, updateMemory } from "../../../../lib/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Correct a saved memory. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await params;

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
        pinned?: unknown;
        confidence?: unknown;
        source?: unknown;
        validation_status?: unknown;
      }
    | null;

  if (typeof payload?.content === "string" && containsSecret(payload.content)) {
    return NextResponse.json(
      { error: "Secrets and credentials are never stored in memory" },
      { status: 422 }
    );
  }
  if (payload?.kind !== undefined && !isMemoryKind(payload.kind)) {
    return NextResponse.json({ error: "Invalid memory kind" }, { status: 400 });
  }
  if (payload?.confidence !== undefined) {
    const conf = Number(payload.confidence);
    if (!Number.isFinite(conf) || conf < 0 || conf > 100) {
      return NextResponse.json({ error: "Confidence must be a number 0-100" }, { status: 400 });
    }
  }
  if (payload?.source !== undefined && !isMemorySource(payload.source)) {
    return NextResponse.json(
      { error: "Invalid source. Must be: user_explicit, inferred, or imported" },
      { status: 400 }
    );
  }
  if (payload?.validation_status !== undefined && !isValidationStatus(payload.validation_status)) {
    return NextResponse.json(
      { error: "Invalid validation_status. Must be: unvalidated, confirmed, disputed, or stale" },
      { status: 400 }
    );
  }

  const result = await updateMemory(user.id, id, {
    content: typeof payload?.content === "string" ? payload.content : undefined,
    kind: isMemoryKind(payload?.kind) ? payload.kind : undefined,
    importance:
      typeof payload?.importance === "number" ? payload.importance : undefined,
    pinned: typeof payload?.pinned === "boolean" ? payload.pinned : undefined,
    confidence: typeof payload?.confidence === "number" ? payload.confidence : undefined,
    source: isMemorySource(payload?.source) ? payload.source : undefined,
    validation_status: isValidationStatus(payload?.validation_status) ? payload.validation_status : undefined
  });

  if (!result.ok) {
    const status =
      result.reason === "secret"
        ? 422
        : result.reason === "unavailable"
          ? 503
          : result.reason === "empty" || result.reason === "kind"
            ? 400
            : 404;
    return NextResponse.json({ error: "Could not update memory" }, { status });
  }

  return NextResponse.json({ memory: result.memory });
}

/** Delete one memory. Ownership is enforced by RLS and an explicit filter. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await params;
  const deleted = await deleteMemory(user.id, id);
  if (!deleted) {
    return NextResponse.json({ error: "Could not delete memory" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id });
}

import { NextResponse } from "next/server";
import { currentUser } from "../../../../../lib/auth";
import { isValidationStatus } from "../../../../../lib/memory-core";
import { validateMemory } from "../../../../../lib/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const payload = body as { status?: unknown } | null;
  const status = payload?.status;

  if (!isValidationStatus(status)) {
    return NextResponse.json(
      { error: "Invalid validation status. Must be: unvalidated, confirmed, disputed, or stale" },
      { status: 400 }
    );
  }

  const result = await validateMemory(user.id, id, status);

  if (!result.ok) {
    const statusCode = result.reason === "unavailable" ? 503 : 404;
    return NextResponse.json({ error: "Could not update validation status" }, { status: statusCode });
  }

  return NextResponse.json({ memory: result.memory });
}
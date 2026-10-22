import { NextResponse } from "next/server";
import { currentUser } from "../../../../../lib/auth";
import { decideApproval } from "../../../../../lib/task-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function PATCH(
  request: Request,
  { params }: { params: Params }
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

  const payload = body as { decision?: unknown } | null;
  const decision = payload?.decision;

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 }
    );
  }

  const result = await decideApproval(user.id, id, decision);

  if (!result.ok) {
    const status = result.reason === "unavailable" ? 503 :
      result.reason === "not_found" ? 404 :
      result.reason === "already_decided" ? 409 :
      result.reason === "expired" ? 410 : 500;
    return NextResponse.json({ error: "Could not process approval" }, { status });
  }

  return NextResponse.json({ task: result.task });
}
import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/auth";
import { getPendingApprovals } from "../../../../lib/task-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const approvals = await getPendingApprovals(user.id);
  return NextResponse.json({ approvals, count: approvals.length });
}
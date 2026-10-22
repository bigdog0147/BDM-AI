import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/auth";
import { getTask, getTaskSteps } from "../../../../lib/task-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function GET(
  _request: Request,
  { params }: { params: Params }
): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await params;

  const task = await getTask(user.id, id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const steps = await getTaskSteps(id);

  return NextResponse.json({ task, steps });
}
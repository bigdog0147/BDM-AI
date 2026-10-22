import { NextResponse } from "next/server";
import { currentUser } from "../../../../../lib/auth";
import { retryTask } from "../../../../../lib/task-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function POST(
  _request: Request,
  { params }: { params: Params }
): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await params;

  const result = await retryTask(user.id, id);

  if (!result.ok) {
    const status = result.reason === "unavailable" ? 503 :
      result.reason === "not_found" ? 404 :
      result.reason === "not_retryable" ? 409 : 500;
    return NextResponse.json({ error: "Could not retry task" }, { status });
  }

  return NextResponse.json({ task: result.task });
}
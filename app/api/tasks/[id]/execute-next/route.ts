import { NextResponse } from "next/server";

import { currentUser } from "../../../../../lib/auth";
import { executeNextTaskStep } from "../../../../../lib/task-agent";

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
  const result = await executeNextTaskStep(user.id, id);

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "invalid_state"
          ? 409
          : result.reason === "no_more_steps"
            ? 409
            : 500;

    return NextResponse.json(
      { error: "Could not execute task step", reason: result.reason },
      { status }
    );
  }

  return NextResponse.json({
    task: result.task,
    stepResult: result.stepResult
  });
}

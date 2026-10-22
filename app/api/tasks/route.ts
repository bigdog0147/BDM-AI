import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth";
import { createTask, listTasks } from "../../../lib/task-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_PLAN_STEPS = 20;

/** List tasks for the signed-in user. */
export async function GET(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") as
    | "queued" | "planning" | "awaiting_approval" | "running" | "verifying" | "completed" | "failed" | "cancelled"
    | null;
  const projectKey = url.searchParams.get("project")?.trim() || null;
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  const tasks = await listTasks(user.id, { status: status ?? undefined, projectKey, limit });
  return NextResponse.json({ tasks, count: tasks.length });
}

/** Create a new task. */
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
    title?: unknown;
    description?: unknown;
    projectKey?: unknown;
    plan?: unknown;
    maxRetries?: unknown;
  } | null;

  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json({ error: "title is too long" }, { status: 413 });
  }

  const description = typeof payload?.description === "string" ? payload.description.trim() : null;
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json({ error: "description is too long" }, { status: 413 });
  }

  const projectKey = typeof payload?.projectKey === "string" && payload.projectKey.trim()
    ? payload.projectKey.trim().slice(0, 100)
    : null;

  // Validate plan
  const rawPlan = payload?.plan;
  if (!Array.isArray(rawPlan) || rawPlan.length === 0) {
    return NextResponse.json({ error: "plan must be a non-empty array of steps" }, { status: 400 });
  }
  if (rawPlan.length > MAX_PLAN_STEPS) {
    return NextResponse.json({ error: `plan cannot exceed ${MAX_PLAN_STEPS} steps` }, { status: 400 });
  }

  const plan = rawPlan.map((step, index) => {
    const s = step as Record<string, unknown> | null;
    if (!s) throw new Error(`step ${index} is invalid`);

    const tool = typeof s.tool === "string" ? s.tool.trim() : "";
    if (!tool) throw new Error(`step ${index}: tool is required`);

    const args = s.args && typeof s.args === "object" ? s.args as Record<string, unknown> : {};
    const expectedOutcome = typeof s.expectedOutcome === "string" ? s.expectedOutcome.trim() : "";
    const idempotent = s.idempotent === true;
    const requiresApproval = s.requiresApproval === true;
    const timeoutMs = typeof s.timeoutMs === "number" && s.timeoutMs > 0 ? s.timeoutMs : 60_000;
    const description = typeof s.description === "string" ? s.description.trim() : "";

    if (!description) throw new Error(`step ${index}: description is required`);
    if (!expectedOutcome) throw new Error(`step ${index}: expectedOutcome is required`);

    return {
      id: `step-${index}`,
      tool,
      args,
      expectedOutcome,
      idempotent,
      requiresApproval,
      timeoutMs,
      description
    };
  });

  const maxRetries = typeof payload?.maxRetries === "number" ? Math.floor(payload.maxRetries) : 3;

  const result = await createTask({
    userId: user.id,
    projectKey,
    title,
    description,
    plan,
    maxRetries
  });

  if (!result.ok) {
    const status = result.reason === "unavailable" ? 503 : result.reason === "empty_plan" ? 400 : 500;
    return NextResponse.json({ error: "Could not create task" }, { status });
  }

  return NextResponse.json({ task: result.task }, { status: 201 });
}
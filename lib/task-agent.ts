import * as fs from "node:fs/promises";
import path from "node:path";

import { createSupabaseServerClient } from "./supabase-server";
import { checkPermission } from "./permissions";
import { recordAuditEvent } from "./audit";
import { canAccessPath } from "./workspace-bounds";
import { getTask, getTaskSteps } from "./task-executor";
import type { Task, TaskStep, TaskCheckpoint } from "./bdm-types";

interface ToolContext {
  userId: string;
}

type ToolResult = { ok: true; result: unknown } | { ok: false; error: string };
type ToolHandler = (step: TaskStep, context: ToolContext) => Promise<ToolResult>;

const TOOL_TIMEOUT_MS = 30_000;
const LEASE_SECONDS = 120;

export class LeaseUnavailableError extends Error {
  constructor(message = "execution claim unavailable") {
    super(message);
    this.name = "LeaseUnavailableError";
  }
}

const toolHandlers: Record<string, ToolHandler> = {
  "filesystem.read": async (step, context) => {
    const requested = String(step.args.path ?? "").trim();
    if (!requested) {
      return { ok: false, error: "missing required 'path' argument" };
    }

    const access = await canAccessPath(context.userId, requested);
    if (!access.allowed || !access.resolvedPath) {
      return { ok: false, error: access.reason ?? "path access denied" };
    }

    try {
      const stat = await fs.stat(access.resolvedPath);
      if (stat.isDirectory()) {
        return { ok: false, error: `requested path is a directory, use filesystem.list instead` };
      }

      const MAX_BYTES = 100 * 1024;
      const buffer = await fs.readFile(access.resolvedPath);
      if (buffer.byteLength > MAX_BYTES) {
        return {
          ok: false,
          error: `file exceeds the ${MAX_BYTES}-byte read limit`
        };
      }

      return {
        ok: true,
        result: {
          path: access.resolvedPath,
          size: buffer.byteLength,
          content: buffer.toString("utf8")
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "file read failed"
      };
    }
  },
  "filesystem.list": async (step, context) => {
    const requested = String(step.args.path ?? "").trim();
    if (!requested) {
      return { ok: false, error: "missing required 'path' argument" };
    }

    const access = await canAccessPath(context.userId, requested);
    if (!access.allowed || !access.resolvedPath) {
      return { ok: false, error: access.reason ?? "path access denied" };
    }

    try {
      const entries = await fs.readdir(access.resolvedPath, { withFileTypes: true });
      return {
        ok: true,
        result: {
          path: access.resolvedPath,
          entries: entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file"
          }))
        }
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "directory list failed" };
    }
  }
};

export function isSupportedToolKey(toolKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(toolHandlers, toolKey);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("step timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function getClient() {
  return createSupabaseServerClient();
}

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

interface LeaseClaim {
  execution_id: string;
  lease_owner: string;
  lease_expires_at: string;
  lease_generation: number;
}

interface ClaimResponse {
  task_id: string;
  current_step: number;
  execution_id: string;
  lease_owner: string;
  lease_expires_at: string;
  lease_generation: number;
}

function isClaimResponse(value: unknown): value is ClaimResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ClaimResponse>;
  return (
    typeof row.task_id === "string" &&
    typeof row.current_step === "number" &&
    typeof row.execution_id === "string" &&
    typeof row.lease_owner === "string" &&
    typeof row.lease_expires_at === "string" &&
    typeof row.lease_generation === "number"
  );
}

interface ExecuteResult {
  ok: true;
  task: Task;
  stepResult: { ok: boolean; result?: unknown; error?: string };
}

interface ExecuteFailure {
  ok: false;
  reason: string;
  task?: Task | null;
}

async function getApprovalState(
  taskId: string,
  stepIndex: number
): Promise<{ approved: boolean; reason?: string }> {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from("bdm_task_approvals")
    .select("status,expires_at")
    .eq("task_id", taskId)
    .eq("step_index", stepIndex)
    .maybeSingle();

  if (error) return { approved: false, reason: "approval_lookup_failed" };
  if (!data) return { approved: true };

  if (data.status !== "approved") {
    return { approved: false, reason: "requires_approval" };
  }

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return { approved: false, reason: "approval_expired" };
  }

  return { approved: true };
}

async function claimStep(
  userId: string,
  taskId: string,
  expectedStep: number
): Promise<
  | { ok: true; claim: LeaseClaim }
  | { ok: false; reason: "claim_unavailable" | "claim_rejected" | "claim_failed" }
> {
  if (!isConfigured()) return { ok: false, reason: "claim_unavailable" };

  try {
    const supabase = await getClient();
    const { data, error } = await supabase.rpc("claim_task_step", {
      p_expected_step: expectedStep,
      p_lease_owner: null,
      p_lease_seconds: LEASE_SECONDS,
      p_task_id: taskId
    });

    if (error) return { ok: false, reason: "claim_unavailable" };

    if (!Array.isArray(data) || data.length === 0 || !isClaimResponse(data[0])) {
      return { ok: false, reason: "claim_rejected" };
    }

    const claim = data[0];
    return {
      ok: true,
      claim: {
        execution_id: claim.execution_id,
        lease_expires_at: claim.lease_expires_at,
        lease_generation: claim.lease_generation,
        lease_owner: claim.lease_owner
      }
    };
  } catch {
    return { ok: false, reason: "claim_failed" };
  }
}

async function readTaskStatus(userId: string, taskId: string): Promise<Task | null> {
  return getTask(userId, taskId);
}

async function isCancelled(userId: string, taskId: string): Promise<boolean> {
  const task = await getTask(userId, taskId);
  return Boolean(task && task.status === "cancelled");
}

async function ensureStepRows(task: Task): Promise<void> {
  const supabase = await getClient();
  const rows = await getTaskSteps(task.id);
  const existing = new Set(rows.map((row) => row.step_index));
  const missing = task.plan
    .map((step: TaskStep, index: number) => ({ step, index }))
    .filter((entry: { step: TaskStep; index: number }) => !existing.has(entry.index))
    .map((entry: { step: TaskStep; index: number }) => ({
      task_id: task.id,
      step_index: entry.index,
      tool_key: entry.step.tool,
      args: entry.step.args,
      expected_outcome: entry.step.expectedOutcome,
      status: "pending",
      idempotent: entry.step.idempotent
    }));

  if (missing.length === 0) return;

  try {
    await supabase.from("bdm_task_steps").insert(missing);
  } catch {
    // Non-critical if rows were concurrently materialized.
  }
}

interface AdvanceTaskStepResult {
  task_status?: string;
  current_step?: number;
}

async function advanceTaskStep(
  task: Task,
  stepIndex: number,
  claim: LeaseClaim,
  result: { ok: boolean; result?: unknown; error?: string },
  durationMs: number
): Promise<Task | null> {
  const supabase = await getClient();
  const step = task.plan[stepIndex];

  try {
    const { data, error } = await supabase.rpc("advance_task_step", {
      p_duration_ms: durationMs,
      p_error: result.ok ? null : (result.error ?? null),
      p_execution_id: claim.execution_id,
      p_expected_step: stepIndex,
      p_idempotent: step.idempotent,
      p_lease_generation: claim.lease_generation,
      p_max_retries: task.max_retries,
      p_result: result.result ?? null,
      p_retry_count: task.retry_count,
      p_success: result.ok,
      p_task_id: task.id
    });

    if (error || !data) return null;

    if (Array.isArray(data) && data.length > 0) {
      const row = data[0] as AdvanceTaskStepResult;
      if (row.task_status === "failed" || row.task_status === "completed" || row.task_status === "running") {
        return await getTask(task.user_id, task.id);
      }
    }

    if (isClaimResponse(data)) {
      return await getTask(task.user_id, task.id);
    }

    return await getTask(task.user_id, task.id);
  } catch {
    return null;
  }
}

async function releaseLease(
  userId: string,
  taskId: string,
  claim: LeaseClaim
): Promise<void> {
  if (!isConfigured()) return;
  try {
    const supabase = await getClient();
    await supabase
      .from("bdm_tasks")
      .update({
        execution_id: null,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", taskId)
      .eq("user_id", userId)
      .eq("execution_id", claim.execution_id)
      .eq("lease_generation", claim.lease_generation);
  } catch {
    // A stale lease can be reacquired by the recovery policy later.
  }
}

async function recordAudit(
  userId: string,
  action: "create" | "fail",
  step: TaskStep,
  taskId: string,
  stepIndex: number,
  executionId: string,
  durationMs: number,
  errorMessage?: string
): Promise<void> {
  await recordAuditEvent({
    action,
    conversationId: null,
    details: {
      duration_ms: durationMs,
      error: errorMessage,
      execution_id: executionId,
      step_index: stepIndex,
      task_id: taskId
    },
    eventType: "system",
    status: action === "create" ? "success" : "failure",
    toolKey: step.tool,
    userId
  });
}

export async function executeNextTaskStep(
  userId: string,
  taskId: string,
  timeoutOverrideMs = TOOL_TIMEOUT_MS
): Promise<ExecuteResult | ExecuteFailure> {
  const initialTask = await getTask(userId, taskId);
  if (!initialTask) {
    return { ok: false, reason: "not_found" };
  }

  if (initialTask.status !== "queued" && initialTask.status !== "planning" && initialTask.status !== "running") {
    return { ok: false, reason: "invalid_state", task: initialTask };
  }

  const stepIndex = initialTask.current_step;
  if (stepIndex >= initialTask.plan.length) {
    return { ok: false, reason: "no_more_steps", task: initialTask };
  }

  const step = initialTask.plan[stepIndex];

  const prePermission = await checkPermission(userId, step.tool);
  if (!prePermission.allowed) {
    return {
      ok: false,
      reason: prePermission.reason === "denied" ? "permission_denied" : "requires_approval",
      task: initialTask
    };
  }

  const preApproval = await getApprovalState(initialTask.id, stepIndex);
  if (!preApproval.approved) {
    return { ok: false, reason: preApproval.reason ?? "requires_approval", task: initialTask };
  }

  const claim = await claimStep(userId, initialTask.id, stepIndex);
  if (!claim.ok) {
    if (claim.reason === "claim_unavailable") {
      return { ok: false, reason: "claim_unavailable" };
    }
    return { ok: false, reason: claim.reason, task: initialTask };
  }

  const claimTask = await readTaskStatus(userId, initialTask.id);
  if (!claimTask) {
    await releaseLease(userId, initialTask.id, claim.claim);
    return { ok: false, reason: "task_not_found" };
  }

  if (claimTask.status === "cancelled") {
    await releaseLease(userId, initialTask.id, claim.claim);
    return { ok: false, reason: "cancelled", task: claimTask };
  }

  await ensureStepRows(claimTask);

  const postApproval = await getApprovalState(claimTask.id, stepIndex);
  if (!postApproval.approved) {
    await releaseLease(userId, claimTask.id, claim.claim);
    return { ok: false, reason: postApproval.reason ?? "requires_approval", task: claimTask };
  }

  const admissionSupabase = await getClient();
  await admissionSupabase
    .from("bdm_task_steps")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("task_id", claimTask.id)
    .eq("step_index", stepIndex)
    .in("status", ["pending"]);

  const handler = toolHandlers[step.tool];
  const stepStart = Date.now();
  let stepResult: { ok: boolean; result?: unknown; error?: string };

  try {
    if (!handler) {
      stepResult = { ok: false, error: `unsupported tool: ${step.tool}` };
    } else {
      stepResult = await withTimeout(handler(step, { userId }), timeoutOverrideMs);
    }
  } catch (error) {
    stepResult = {
      ok: false,
      error: error instanceof Error ? error.message : "tool execution failed"
    };
  }

  const durationMs = Date.now() - stepStart;

  if (await isCancelled(userId, claimTask.id)) {
    await releaseLease(userId, claimTask.id, claim.claim);
    const supabase = await getClient();
    await supabase
      .from("bdm_task_steps")
      .update({ status: "skipped", completed_at: new Date().toISOString(), duration_ms: durationMs })
      .eq("task_id", claimTask.id)
      .eq("step_index", stepIndex)
      .eq("status", "running");
    return { ok: false, reason: "cancelled", task: await getTask(userId, claimTask.id) };
  }

  const advancedTask = await advanceTaskStep(claimTask, stepIndex, claim.claim, stepResult, durationMs);

  await recordAudit(
    userId,
    stepResult.ok ? "create" : "fail",
    step,
    claimTask.id,
    stepIndex,
    claim.claim.execution_id,
    durationMs,
    stepResult.ok ? undefined : stepResult.error
  );

  if (!advancedTask) {
    await releaseLease(userId, claimTask.id, claim.claim);
    return {
      ok: false,
      reason: "execution_conflict",
      task: await getTask(userId, claimTask.id)
    };
  }

  if (stepResult.ok) {
    await recordAuditEvent({
      action: "complete",
      details: {
        execution_id: claim.claim.execution_id,
        step_index: stepIndex,
        task_id: claimTask.id
      },
      eventType: "task",
      status: "success",
      toolKey: "task.executor",
      userId
    }).catch(() => undefined);
  }

  return {
    ok: true,
    task: advancedTask,
    stepResult
  };
}

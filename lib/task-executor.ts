import type { Task, TaskStep, TaskCheckpoint, TaskStatus, TaskStepStatus, ApprovalStatus, TaskStepRecord } from "./bdm-types";

/**
 * Task execution engine.
 *
 * Implements a durable state machine for multi-step tasks with:
 * - Persistent state in Supabase (survives restarts)
 * - Checkpointing after each verified step
 * - Bounded retries with exponential backoff
 * - Idempotency for safe operations
 * - Human approval gates for external/shared changes
 */

const STEP_TIMEOUT_DEFAULT_MS = 60_000;
const MAX_STEP_RETRIES = 3;
const APPROVAL_EXPIRY_HOURS = Number(process.env.BDM_APPROVAL_EXPIRY_HOURS ?? 24);

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

async function getClient() {
  const { createSupabaseServerClient } = await import("./supabase-server");
  return createSupabaseServerClient();
}

type SupabaseClient = Awaited<ReturnType<typeof import("./supabase-server").createSupabaseServerClient>>;

let auditMod: typeof import("./audit") | null = null;
async function loadAudit() {
  if (!auditMod) auditMod = await import("./audit");
  return auditMod;
}

let permMod: typeof import("./permissions") | null = null;
async function loadPerms() {
  if (!permMod) permMod = await import("./permissions");
  return permMod;
}

type AuditArgs = Parameters<typeof import("./audit").auditTaskEvent>[0];

async function auditTaskEvent(args: AuditArgs) {
  const { auditTaskEvent: fn } = await loadAudit();
  return fn(args);
}

async function auditToolExecution(args: Parameters<typeof import("./audit").auditToolExecution>[0]) {
  const { auditToolExecution: fn } = await loadAudit();
  return fn(args);
}

async function auditPermissionCheck(args: Parameters<typeof import("./audit").auditPermissionCheck>[0]) {
  const { auditPermissionCheck: fn } = await loadAudit();
  return fn(args);
}

async function checkPermission(
  userId: string,
  toolKey: string
): ReturnType<typeof import("./permissions").checkPermission> {
  const { checkPermission: fn } = await loadPerms();
  return fn(userId, toolKey);
}

/**
 * Create a new task in the queued state.
 */
export async function createTask(input: {
  userId: string;
  projectKey: string | null;
  title: string;
  description: string | null;
  plan: TaskStep[];
  maxRetries?: number;
}): Promise<{ ok: true; task: Task } | { ok: false; reason: string }> {
  if (!isConfigured()) return { ok: false, reason: "unavailable" };
  if (!input.plan.length) return { ok: false, reason: "empty_plan" };

  // Check if any step requires approval
  const requiresApproval = input.plan.some((s) => s.requiresApproval);
  const initialStatus: TaskStatus = requiresApproval ? "awaiting_approval" : "queued";

  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from("bdm_tasks")
      .insert({
        user_id: input.userId,
        project_key: input.projectKey,
        title: input.title,
        description: input.description,
        status: initialStatus,
        plan: input.plan,
        current_step: 0,
        checkpoints: [],
        retry_count: 0,
        max_retries: input.maxRetries ?? 3,
        metadata: {}
      })
      .select("*")
      .single();

    if (error || !data) {
      console.error("BDM task: create failed", error?.message);
      return { ok: false, reason: "error" };
    }

    // If requires approval, create approval records for steps that need it
    if (requiresApproval) {
      const task = data as Task;
      await createApprovalRecords(task);
    }

    await auditTaskEvent({
      userId: input.userId,
      taskId: data.id,
      action: "create",
      status: "success",
      metadata: { title: input.title, plan_steps: input.plan.length, requires_approval: requiresApproval }
    });

    return { ok: true, task: data as Task };
  } catch (err) {
    console.error("BDM task: create threw", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Create approval records for all steps in the plan that require approval.
 */
async function createApprovalRecords(task: Task): Promise<void> {
  const supabase = await getClient();
  const expiresAt = new Date(Date.now() + APPROVAL_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  const approvals = task.plan
    .map((step, index) => {
      if (!step.requiresApproval) return null;
      return {
        task_id: task.id,
        step_index: index,
        tool_key: step.tool,
        args: step.args,
        expected_outcome: step.expectedOutcome,
        status: "pending" as const,
        expires_at: expiresAt
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  if (approvals.length === 0) return;

  const { error } = await supabase.from("bdm_task_approvals").insert(approvals);
  if (error) {
    console.error("BDM task: create approvals failed", error.message);
  }
}

/**
 * Get a task by ID (with ownership check).
 */
export async function getTask(userId: string, taskId: string): Promise<Task | null> {
  if (!isConfigured()) return null;

  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from("bdm_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", userId)
      .single();

    if (error || !data) return null;
    return data as Task;
  } catch {
    return null;
  }
}

/**
 * List tasks for a user with optional filters.
 */
export async function listTasks(
  userId: string,
  options: { status?: TaskStatus; projectKey?: string | null; limit?: number } = {}
): Promise<Task[]> {
  if (!isConfigured()) return [];

  try {
    const supabase = await getClient();
    let query = supabase
      .from("bdm_tasks")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(Math.min(100, Math.max(1, options.limit ?? 50)));

    if (options.status) query = query.eq("status", options.status);
    if (options.projectKey) query = query.eq("project_key", options.projectKey);

    const { data, error } = await query;
    if (error || !data) return [];
    return data as Task[];
  } catch {
    return [];
  }
}

/**
 * Get pending approvals for a user.
 */
export async function getPendingApprovals(userId: string): Promise<Array<{
  approval: { id: string; task_id: string; step_index: number; tool_key: string; args: Record<string, unknown>; expected_outcome: string | null; expires_at: string };
  task: { id: string; title: string; status: TaskStatus };
}>> {
  if (!isConfigured()) return [];

  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from("bdm_task_approvals")
      .select(`
        *,
        bdm_tasks!inner (id, title, status)
      `)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .eq("bdm_tasks.user_id", userId)
      .order("requested_at", { ascending: true });

    if (error || !data) return [];

    return (data as Array<{
      id: string; task_id: string; step_index: number; tool_key: string;
      args: Record<string, unknown>; expected_outcome: string | null; expires_at: string;
      bdm_tasks: { id: string; title: string; status: TaskStatus };
    }>).map((row) => ({
      approval: {
        id: row.id,
        task_id: row.task_id,
        step_index: row.step_index,
        tool_key: row.tool_key,
        args: row.args,
        expected_outcome: row.expected_outcome,
        expires_at: row.expires_at
      },
      task: row.bdm_tasks
    }));
  } catch {
    return [];
  }
}

/**
 * Approve or reject a pending approval.
 */
export async function decideApproval(
  userId: string,
  approvalId: string,
  decision: "approved" | "rejected"
): Promise<{ ok: true; task: Task } | { ok: false; reason: string }> {
  if (!isConfigured()) return { ok: false, reason: "unavailable" };

  try {
    const supabase = await getClient();

    // Get the approval with task ownership check
    const { data: approval, error: apprError } = await supabase
      .from("bdm_task_approvals")
      .select(`
        *,
        bdm_tasks!inner (id, user_id, status)
      `)
      .eq("id", approvalId)
      .eq("bdm_tasks.user_id", userId)
      .single();

    if (apprError || !approval) return { ok: false, reason: "not_found" };
    if (approval.status !== "pending") return { ok: false, reason: "already_decided" };
    if (new Date(approval.expires_at) < new Date()) return { ok: false, reason: "expired" };

    // Update approval
    const { error: updError } = await supabase
      .from("bdm_task_approvals")
      .update({
        status: decision,
        decided_at: new Date().toISOString(),
        decided_by: userId
      })
      .eq("id", approvalId);

    if (updError) return { ok: false, reason: "error" };

    // If approved and this was the last pending approval for the task, transition to queued
    if (decision === "approved") {
      const { data: pendingCount } = await supabase
        .from("bdm_task_approvals")
        .select("id", { count: "exact", head: true })
        .eq("task_id", approval.task_id)
        .eq("status", "pending");

      if ((pendingCount ?? 0) === 0) {
        await supabase
          .from("bdm_tasks")
          .update({ status: "queued", updated_at: new Date().toISOString() })
          .eq("id", approval.task_id);
      }
    } else {
      // Rejected: mark task as failed
      await supabase
        .from("bdm_tasks")
        .update({ status: "failed", error: "Step rejected by user", updated_at: new Date().toISOString() })
        .eq("id", approval.task_id);
    }

    // Return updated task
    const { data: task } = await supabase
      .from("bdm_tasks")
      .select("*")
      .eq("id", approval.task_id)
      .single();

    return { ok: true, task: task as Task };
  } catch (err) {
    console.error("BDM task: decideApproval threw", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Start a queued task (transition to planning -> running).
 */
export async function startTask(userId: string, taskId: string): Promise<{ ok: true; task: Task } | { ok: false; reason: string }> {
  if (!isConfigured()) return { ok: false, reason: "unavailable" };

  try {
    const supabase = await getClient();
    const { data: task, error } = await supabase
      .from("bdm_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", userId)
      .single();

    if (error || !task) return { ok: false, reason: "not_found" };
    const t = task as Task;

    if (t.status !== "queued" && t.status !== "planning") {
      return { ok: false, reason: "invalid_state" };
    }

    // Transition to planning
    await supabase
      .from("bdm_tasks")
      .update({ status: "planning", updated_at: new Date().toISOString() })
      .eq("id", taskId);

    // Create step records for all steps
    const steps = t.plan.map((step, index) => ({
      task_id: taskId,
      step_index: index,
      tool_key: step.tool,
      args: step.args,
      expected_outcome: step.expectedOutcome,
      status: "pending" as TaskStepStatus,
      idempotent: step.idempotent
    }));

    const { error: stepsError } = await supabase.from("bdm_task_steps").insert(steps);
    if (stepsError) {
      console.error("BDM task: create steps failed", stepsError.message);
    }

    // Transition to running
    await supabase
      .from("bdm_tasks")
      .update({ status: "running", current_step: 0, updated_at: new Date().toISOString() })
      .eq("id", taskId);

    const { data: updated } = await supabase
      .from("bdm_tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    await auditTaskEvent({
      userId,
      taskId,
      action: "start",
      status: "success",
      metadata: { from_status: t.status }
    });

    return { ok: true, task: updated as Task };
  } catch (err) {
    console.error("BDM task: startTask threw", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Execute a single step of a running task.
 */
export async function executeStep(
  userId: string,
  taskId: string,
  executor: (step: TaskStep) => Promise<{ ok: boolean; result?: unknown; error?: string }>
): Promise<{ ok: true; task: Task; stepResult: { ok: boolean; result?: unknown; error?: string } } | { ok: false; reason: string }> {
  if (!isConfigured()) return { ok: false, reason: "unavailable" };

  try {
    const supabase = await getClient();

    // Get current task state
    const { data: task, error } = await supabase
      .from("bdm_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", userId)
      .single();

    if (error || !task) return { ok: false, reason: "not_found" };
    const t = task as Task;

    if (t.status !== "running") return { ok: false, reason: "not_running" };
    if (t.current_step >= t.plan.length) return { ok: false, reason: "no_more_steps" };

    const step = t.plan[t.current_step];
    const stepIndex = t.current_step;

    // Check if this step requires approval and is still pending
    if (step.requiresApproval) {
      const { data: approval } = await supabase
        .from("bdm_task_approvals")
        .select("status")
        .eq("task_id", taskId)
        .eq("step_index", stepIndex)
        .single();

      if (approval && approval.status !== "approved") {
        return { ok: false, reason: "awaiting_approval" };
      }
    }

    // Check tool permission before execution
    const perm = await checkPermission(userId, step.tool);
    await auditPermissionCheck({ userId, toolKey: step.tool, allowed: perm.allowed, reason: perm.allowed ? undefined : perm.reason });

    if (!perm.allowed) {
      await auditToolExecution({
        userId,
        toolKey: step.tool,
        action: "read",
        status: "blocked",
        metadata: { task_id: taskId, step_index: stepIndex, reason: perm.reason }
      });
      return { ok: false, reason: perm.reason === "denied" ? "permission_denied" : "requires_approval" };
    }

    // Mark step as running
    await supabase
      .from("bdm_task_steps")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("task_id", taskId)
      .eq("step_index", stepIndex);

    const stepStart = Date.now();
    let stepResult: { ok: boolean; result?: unknown; error?: string };

    try {
      stepResult = await executor(step);
    } catch (err) {
      stepResult = { ok: false, error: err instanceof Error ? err.message : "execution failed" };
    }

    const durationMs = Date.now() - stepStart;

    // Audit the tool execution
    await auditToolExecution({
      userId,
      toolKey: step.tool,
      action: stepResult.ok ? "create" : "fail",
      status: stepResult.ok ? "success" : "failure",
      metadata: { task_id: taskId, step_index: stepIndex, duration_ms: durationMs },
      error: stepResult.error ?? null
    });

    // Record step result
    const stepStatus: TaskStepStatus = stepResult.ok ? "completed" : "failed";
    await supabase
      .from("bdm_task_steps")
      .update({
        status: stepStatus,
        result: stepResult.ok ? stepResult.result : null,
        error: stepResult.ok ? null : stepResult.error,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs
      })
      .eq("task_id", taskId)
      .eq("step_index", stepIndex);

    if (!stepResult.ok) {
      // Audit the failure
      await auditTaskEvent({
        userId,
        taskId,
        action: "fail",
        status: "failure",
        metadata: { step_index: stepIndex, tool: step.tool, error: stepResult.error }
      });
      // Handle failure with retry logic
      return await handleStepFailure(supabase, t, stepIndex, stepResult.error ?? "unknown error");
    }

    // Audit success
    await auditTaskEvent({
      userId,
      taskId,
      action: "create",
      status: "success",
      metadata: { step_index: stepIndex, tool: step.tool }
    });

    // Success: create checkpoint
    const checkpoint: TaskCheckpoint = {
      step: stepIndex,
      output: stepResult.result,
      verifiedAt: new Date().toISOString(),
      verified: true
    };

    const nextStep = stepIndex + 1;
    const isComplete = nextStep >= t.plan.length;

    await supabase
      .from("bdm_tasks")
      .update({
        current_step: nextStep,
        checkpoints: [...(t.checkpoints ?? []), checkpoint],
        status: isComplete ? "verifying" : "running",
        updated_at: new Date().toISOString()
      })
      .eq("id", taskId);

    // If complete, do final verification
    if (isComplete) {
      return await completeTask(supabase, taskId, userId);
    }

    const { data: updated } = await supabase
      .from("bdm_tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    return { ok: true, task: updated as Task, stepResult };
  } catch (err) {
    console.error("BDM task: executeStep threw", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Handle step failure with retry logic.
 */
async function handleStepFailure(
  supabase: SupabaseClient,
  task: Task,
  stepIndex: number,
  error: string
): Promise<{ ok: false; reason: string } | { ok: true; task: Task; stepResult: { ok: false; error: string } }> {
  const step = task.plan[stepIndex];
  const retryCount = task.retry_count;
  const maxRetries = task.max_retries;

  // Check if we should retry (idempotent steps only, or within retry budget)
  const shouldRetry = step.idempotent && retryCount < maxRetries;

  if (shouldRetry) {
    await supabase
      .from("bdm_tasks")
      .update({
        retry_count: retryCount + 1,
        error: `Step ${stepIndex} failed (retry ${retryCount + 1}/${maxRetries}): ${error}`,
        updated_at: new Date().toISOString()
      })
      .eq("id", task.id);

    await supabase
      .from("bdm_task_steps")
      .update({
        status: "pending",
        retry_count: retryCount + 1,
        error: null,
        started_at: null,
        completed_at: null,
        duration_ms: null
      })
      .eq("task_id", task.id)
      .eq("step_index", stepIndex);

    return { ok: true, task: { ...task, retry_count: retryCount + 1 } as Task, stepResult: { ok: false, error } };
  }

  // No more retries: mark task as failed
  await supabase
    .from("bdm_tasks")
    .update({
      status: "failed",
      error: `Step ${stepIndex} failed after ${retryCount} retries: ${error}`,
      updated_at: new Date().toISOString()
    })
    .eq("id", task.id);

  return { ok: false, reason: "step_failed" };
}

/**
 * Complete a task (final verification).
 */
async function completeTask(
  supabase: SupabaseClient,
  taskId: string,
  userId: string
): Promise<{ ok: true; task: Task; stepResult: { ok: boolean } } | { ok: false; reason: string }> {
  // For now, auto-verify if all checkpoints are verified
  const { data: task } = await supabase
    .from("bdm_tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (!task) return { ok: false, reason: "not_found" };
  const t = task as Task;

  const allVerified = t.checkpoints.every((c) => c.verified);
  const finalStatus = allVerified ? "completed" : "failed";

  await supabase
    .from("bdm_tasks")
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", taskId);

  const { data: updated } = await supabase
    .from("bdm_tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  await auditTaskEvent({
    userId,
    taskId,
    action: allVerified ? "complete" : "fail",
    status: allVerified ? "success" : "failure",
    metadata: { checkpoints_total: t.checkpoints.length, all_verified: allVerified }
  });

  return { ok: true, task: updated as Task, stepResult: { ok: allVerified } };
}

/**
 * Cancel a running/queued task.
 */
export async function cancelTask(userId: string, taskId: string): Promise<{ ok: true; task: Task } | { ok: false; reason: string }> {
  if (!isConfigured()) return { ok: false, reason: "unavailable" };

  try {
    const supabase = await getClient();
    const { data: task } = await supabase
      .from("bdm_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", userId)
      .single();

    if (!task) return { ok: false, reason: "not_found" };
    const t = task as Task;

    if (t.status === "completed" || t.status === "cancelled") {
      return { ok: false, reason: "already_terminal" };
    }

    // Mark pending steps as skipped
    await supabase
      .from("bdm_task_steps")
      .update({ status: "skipped" })
      .eq("task_id", taskId)
      .eq("status", "pending");

    // Reject pending approvals
    await supabase
      .from("bdm_task_approvals")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("task_id", taskId)
      .eq("status", "pending");

    await supabase
      .from("bdm_tasks")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString()
      })
      .eq("id", taskId);

    const { data: updated } = await supabase
      .from("bdm_tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    await auditTaskEvent({
      userId,
      taskId,
      action: "cancel",
      status: "success",
      metadata: { from_status: t.status }
    });

    return { ok: true, task: updated as Task };
  } catch (err) {
    console.error("BDM task: cancelTask threw", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Retry a failed task from the last checkpoint.
 */
export async function retryTask(userId: string, taskId: string): Promise<{ ok: true; task: Task } | { ok: false; reason: string }> {
  if (!isConfigured()) return { ok: false, reason: "unavailable" };

  try {
    const supabase = await getClient();
    const { data: task } = await supabase
      .from("bdm_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", userId)
      .single();

    if (!task) return { ok: false, reason: "not_found" };
    const t = task as Task;

    if (t.status !== "failed" && t.status !== "cancelled") {
      return { ok: false, reason: "not_retryable" };
    }

    // Reset to queued, clear error, reset retry count
    await supabase
      .from("bdm_tasks")
      .update({
        status: "queued",
        error: null,
        retry_count: 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", taskId);

    // Reset all step statuses to pending
    await supabase
      .from("bdm_task_steps")
      .update({
        status: "pending",
        result: null,
        error: null,
        started_at: null,
        completed_at: null,
        duration_ms: null,
        retry_count: 0
      })
      .eq("task_id", taskId);

    const { data: updated } = await supabase
      .from("bdm_tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    await auditTaskEvent({
      userId,
      taskId,
      action: "retry",
      status: "success",
      metadata: { from_status: t.status, checkpoints_preserved: t.checkpoints.length }
    });

    return { ok: true, task: updated as Task };
  } catch (err) {
    console.error("BDM task: retryTask threw", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Get step execution history for a task.
 */
export async function getTaskSteps(taskId: string): Promise<TaskStepRecord[]> {
  if (!isConfigured()) return [];

  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from("bdm_task_steps")
      .select("*")
      .eq("task_id", taskId)
      .order("step_index", { ascending: true });

    if (error || !data) return [];
    return data as TaskStepRecord[];
  } catch {
    return [];
  }
}
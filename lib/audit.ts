import { createSupabaseServerClient } from "./supabase-server";

/**
 * Audit event logging.
 *
 * Records significant actions to `bdm_audit_events` (created in 0001_bdm_foundation.sql).
 * All fields are redacted for safety - no secrets, no full request bodies.
 */

export type AuditEventType =
  | "task"
  | "memory"
  | "email"
  | "search"
  | "auth"
  | "deployment"
  | "permission"
  | "system"
  | "image";

export type AuditAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "start"
  | "complete"
  | "fail"
  | "cancel"
  | "retry"
  | "approve"
  | "reject"
  | "login"
  | "logout"
  | "link"
  | "unlink"
  | "rotate"
  | "deploy"
  | "generate"
  | "send"
  | "validate"
  | "supersede"
  | "compact";

export type AuditStatus = "success" | "failure" | "pending" | "blocked";

export interface AuditEvent {
  id: string;
  user_id: string;
  event_type: AuditEventType;
  action: AuditAction;
  status: AuditStatus;
  conversation_id: string | null;
  tool_key: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

async function getClient() {
  return createSupabaseServerClient();
}

/**
 * Record an audit event.
 * Never throws - failures are logged server-side only.
 * All sensitive data must be redacted by the caller.
 */
export async function recordAuditEvent(input: {
  userId: string;
  eventType: AuditEventType;
  action: AuditAction;
  status: AuditStatus;
  conversationId?: string | null;
  toolKey?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (!isConfigured()) return;

  try {
    const supabase = await getClient();
    const { error } = await supabase.from("bdm_audit_events").insert({
      user_id: input.userId,
      event_type: input.eventType,
      action: input.action,
      status: input.status,
      conversation_id: input.conversationId ?? null,
      tool_key: input.toolKey ?? null,
      details: input.details ?? {}
    });

    if (error) {
      console.error("BDM audit: insert failed", error.message);
    }
  } catch (err) {
    console.error("BDM audit: threw", err);
  }
}

/**
 * Convenience: record a tool execution audit.
 */
export async function auditToolExecution(input: {
  userId: string;
  toolKey: string;
  action: AuditAction;
  status: AuditStatus;
  conversationId?: string | null;
  metadata?: Record<string, unknown>;
  error?: string | null;
}): Promise<void> {
  await recordAuditEvent({
    userId: input.userId,
    eventType: "system",
    action: input.action,
    status: input.status,
    conversationId: input.conversationId,
    toolKey: input.toolKey,
    details: {
      ...input.metadata,
      error: input.error
    }
  });
}

/**
 * Convenience: record a permission check result.
 */
export async function auditPermissionCheck(input: {
  userId: string;
  toolKey: string;
  allowed: boolean;
  reason?: "denied" | "requires_approval";
}): Promise<void> {
  await recordAuditEvent({
    userId: input.userId,
    eventType: "permission",
    action: "read",
    status: input.allowed ? "success" : "blocked",
    toolKey: input.toolKey,
    details: {
      allowed: input.allowed,
      reason: input.reason
    }
  });
}

/**
 * Convenience: record task lifecycle events.
 */
export async function auditTaskEvent(input: {
  userId: string;
  taskId: string;
  action: "create" | "start" | "complete" | "fail" | "cancel" | "retry";
  status: AuditStatus;
  conversationId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await recordAuditEvent({
    userId: input.userId,
    eventType: "task",
    action: input.action,
    status: input.status,
    conversationId: input.conversationId,
    toolKey: "task.executor",
    details: {
      task_id: input.taskId,
      ...input.metadata
    }
  });
}

/**
 * Convenience: record memory events.
 */
export async function auditMemoryEvent(input: {
  userId: string;
  action: "create" | "read" | "update" | "delete" | "validate" | "supersede" | "compact";
  status: AuditStatus;
  memoryId?: string;
  conversationId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await recordAuditEvent({
    userId: input.userId,
    eventType: "memory",
    action: input.action,
    status: input.status,
    conversationId: input.conversationId,
    toolKey: "memory.store",
    details: {
      memory_id: input.memoryId,
      ...input.metadata
    }
  });
}

/**
 * Query audit events for a user (for admin/history UI).
 */
export async function getAuditEvents(
  userId: string,
  options: {
    eventType?: AuditEventType;
    toolKey?: string;
    limit?: number;
    since?: Date;
  } = {}
): Promise<AuditEvent[]> {
  if (!isConfigured()) return [];

  try {
    const supabase = await getClient();
    let query = supabase
      .from("bdm_audit_events")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(500, Math.max(1, options.limit ?? 100)));

    if (options.eventType) query = query.eq("event_type", options.eventType);
    if (options.toolKey) query = query.eq("tool_key", options.toolKey);
    if (options.since) query = query.gte("created_at", options.since.toISOString());

    const { data, error } = await query;
    if (error || !data) return [];
    return data as AuditEvent[];
  } catch {
    return [];
  }
}
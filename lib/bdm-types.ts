/**
 * Typed shapes for the BDM Supabase schema (bdm_* tables).
 *
 * These mirror the live database exactly (verified against a schema dump of
 * project lensupaeopgogulfkxar on 2026-10-14). RLS enforces per-user
 * ownership; the client only ever sees its own rows.
 */

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  model_hint: string | null;
  metadata: Record<string, unknown>;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: unknown; // jsonb
  model: string | null;
  tool_name: string | null;
  tool_call_id: string | null;
  token_usage: Record<string, unknown>;
  created_at: string;
}

export interface Profile {
  user_id: string;
  display_name: string | null;
  preferred_name: string | null;
  timezone: string | null;
  locale: string;
  personality: Record<string, unknown>;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type MemoryKind =
  | "fact"
  | "preference"
  | "goal"
  | "project"
  | "person"
  | "instruction"
  | "summary";

export type MemorySource = "user_explicit" | "inferred" | "imported";
export type ValidationStatus = "unvalidated" | "confirmed" | "disputed" | "stale";

export type TaskStatus =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface TaskStep {
  id: string;
  description: string;
  tool: string;
  args: Record<string, unknown>;
  expectedOutcome: string;
  idempotent: boolean;
  requiresApproval: boolean;
  timeoutMs: number;
}

export interface TaskCheckpoint {
  step: number;
  output: unknown;
  verifiedAt: string;
  verified: boolean;
}

export interface Task {
  id: string;
  user_id: string;
  project_key: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  plan: TaskStep[];
  current_step: number;
  checkpoints: TaskCheckpoint[];
  retry_count: number;
  max_retries: number;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskStepRecord {
  id: string;
  task_id: string;
  step_index: number;
  tool_key: string;
  args: Record<string, unknown>;
  expected_outcome: string | null;
  status: TaskStepStatus;
  result: unknown | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  retry_count: number;
  idempotent: boolean;
  created_at: string;
}

export interface TaskApproval {
  id: string;
  task_id: string;
  step_index: number;
  tool_key: string;
  args: Record<string, unknown>;
  expected_outcome: string | null;
  status: ApprovalStatus;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  expires_at: string;
  created_at: string;
}

export interface Memory {
  id: string;
  user_id: string;
  kind: MemoryKind;
  content: string;
  importance: number; // 0-100
  confidence: number; // 0-100
  source: MemorySource;
  source_conversation_id: string | null;
  metadata: Record<string, unknown>;
  pinned: boolean;
  superseded_by: string | null;
  superseded_at: string | null;
  validation_status: ValidationStatus;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

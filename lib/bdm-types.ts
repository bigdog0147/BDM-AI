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

export interface Memory {
  id: string;
  user_id: string;
  kind: MemoryKind;
  content: string;
  importance: number; // 0-100
  source_conversation_id: string | null;
  metadata: Record<string, unknown>;
  pinned: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

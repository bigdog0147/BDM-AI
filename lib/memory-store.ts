import type { Memory, MemoryKind } from "./bdm-types";
import { createSupabaseServerClient } from "./supabase-server";
import {
  clampImportance,
  containsSecret,
  isMemoryKind,
  selectRelevantMemories
} from "./memory-core";

/**
 * Data access for long-term memory (bdm_memories).
 *
 * Every query filters on user_id in addition to Row Level Security. RLS is
 * the real boundary; the explicit filter is defence in depth so a future
 * policy mistake cannot silently turn into a cross-user read.
 *
 * All functions degrade to "unavailable" instead of throwing, matching the
 * best-effort persistence pattern already used for conversations.
 */

export interface SaveMemoryInput {
  userId: string;
  content: string;
  kind?: MemoryKind;
  importance?: number;
  /** Optional project/workspace scope, stored in metadata.project. */
  project?: string | null;
  pinned?: boolean;
  sourceConversationId?: string | null;
}

export type SaveMemoryResult =
  | { ok: true; memory: Memory }
  | { ok: false; reason: "empty" | "secret" | "unavailable" | "error" };

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

async function client() {
  return createSupabaseServerClient();
}

export async function saveMemory(
  input: SaveMemoryInput
): Promise<SaveMemoryResult> {
  const content = input.content.replace(/\s+/g, " ").trim();
  if (!content) return { ok: false, reason: "empty" };
  // Safety boundary: a credential must never become a permanent record.
  if (containsSecret(content)) return { ok: false, reason: "secret" };
  if (!isConfigured()) return { ok: false, reason: "unavailable" };

  const kind = isMemoryKind(input.kind) ? input.kind : "fact";
  const metadata: Record<string, unknown> = {};
  if (input.project) metadata.project = input.project;

  try {
    const supabase = await client();
    const { data, error } = await supabase
      .from("bdm_memories")
      .insert({
        user_id: input.userId,
        kind,
        content: content.slice(0, 4000),
        importance: clampImportance(input.importance ?? 50),
        pinned: Boolean(input.pinned),
        metadata,
        source_conversation_id: input.sourceConversationId ?? null
      })
      .select("*")
      .single();

    if (error || !data) {
      console.error("BDM memory: save failed", error?.message);
      return { ok: false, reason: "error" };
    }
    return { ok: true, memory: data as Memory };
  } catch (err) {
    console.error("BDM memory: save threw", err);
    return { ok: false, reason: "error" };
  }
}

export async function listMemories(
  userId: string,
  options: { query?: string; project?: string | null; limit?: number } = {}
): Promise<Memory[]> {
  if (!isConfigured()) return [];
  const limit = Math.min(500, Math.max(1, options.limit ?? 200));

  try {
    const supabase = await client();
    const { data, error } = await supabase
      .from("bdm_memories")
      .select("*")
      .eq("user_id", userId)
      .order("pinned", { ascending: false })
      .order("importance", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error || !data) {
      console.error("BDM memory: list failed", error?.message);
      return [];
    }

    let memories = data as Memory[];
    if (options.project) {
      memories = memories.filter((memory) => {
        const scoped = memory.metadata?.project;
        return typeof scoped !== "string" || scoped === options.project;
      });
    }
    const query = options.query?.trim();
    if (query) {
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      memories = memories.filter((memory) => {
        const haystack = memory.content.toLowerCase();
        return tokens.some((token) => haystack.includes(token));
      });
    }
    return memories;
  } catch (err) {
    console.error("BDM memory: list threw", err);
    return [];
  }
}

/**
 * Retrieve only the memories relevant to this turn.
 *
 * Never returns the whole set: unrelated facts stay out of the prompt.
 */
export async function retrieveRelevantMemories(
  userId: string,
  query: string,
  options: { project?: string | null; limit?: number } = {}
): Promise<Memory[]> {
  const all = await listMemories(userId, {
    project: options.project ?? undefined
  });
  return selectRelevantMemories(all, query, {
    projectKey: options.project ?? null,
    limit: options.limit ?? 6
  });
}

export async function updateMemory(
  userId: string,
  id: string,
  patch: {
    content?: string;
    kind?: MemoryKind;
    importance?: number;
    pinned?: boolean;
  }
): Promise<{ ok: true; memory: Memory } | { ok: false; reason: string }> {
  if (!isConfigured()) return { ok: false, reason: "unavailable" };

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof patch.content === "string") {
    const content = patch.content.replace(/\s+/g, " ").trim();
    if (!content) return { ok: false, reason: "empty" };
    if (containsSecret(content)) return { ok: false, reason: "secret" };
    update.content = content.slice(0, 4000);
  }
  if (patch.kind !== undefined) {
    if (!isMemoryKind(patch.kind)) return { ok: false, reason: "kind" };
    update.kind = patch.kind;
  }
  if (patch.importance !== undefined) {
    update.importance = clampImportance(patch.importance);
  }
  if (patch.pinned !== undefined) update.pinned = Boolean(patch.pinned);

  try {
    const supabase = await client();
    const { data, error } = await supabase
      .from("bdm_memories")
      .update(update)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error || !data) {
      console.error("BDM memory: update failed", error?.message);
      return { ok: false, reason: "error" };
    }
    return { ok: true, memory: data as Memory };
  } catch (err) {
    console.error("BDM memory: update threw", err);
    return { ok: false, reason: "error" };
  }
}

export async function deleteMemory(
  userId: string,
  id: string
): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const supabase = await client();
    // Return the deleted row: a delete that matched nothing (wrong id, or a
    // row owned by somebody else) must not be reported as success.
    const { data, error } = await supabase
      .from("bdm_memories")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id");
    if (error) {
      console.error("BDM memory: delete failed", error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    console.error("BDM memory: delete threw", err);
    return false;
  }
}

/**
 * Clear memories for one user.
 *
 * One scoped DELETE rather than "list ids, then delete them": the old
 * approach put up to 500 UUIDs in the request URL, silently stopped at 500
 * rows, and (because the list included global memories) a project-scoped
 * clear also wiped memories that belonged to no project. Here the database
 * does the filtering, user_id is always applied, and a project-scoped clear
 * removes only that project's rows.
 */
export async function clearMemories(
  userId: string,
  options: { project?: string | null } = {}
): Promise<number> {
  if (!isConfigured()) return 0;

  try {
    const supabase = await client();
    let query = supabase.from("bdm_memories").delete().eq("user_id", userId);
    if (options.project) {
      query = query.eq("metadata->>project", options.project);
    }
    const { data, error } = await query.select("id");
    if (error) {
      console.error("BDM memory: clear failed", error.message);
      return 0;
    }
    return Array.isArray(data) ? data.length : 0;
  } catch (err) {
    console.error("BDM memory: clear threw", err);
    return 0;
  }
}

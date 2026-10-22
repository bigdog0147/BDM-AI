import type { Memory, MemoryKind, MemorySource, ValidationStatus } from "./bdm-types";
import { createSupabaseServerClient } from "./supabase-server";
import {
  clampImportance,
  compactMemories,
  containsSecret,
  findDuplicateGroups,
  isMemoryKind,
  isMemorySource,
  isValidationStatus,
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
  confidence?: number;
  source?: MemorySource;
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
  const source = isMemorySource(input.source) ? input.source : "user_explicit";
  const confidence = typeof input.confidence === "number" ? Math.round(input.confidence) : 80;
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
        confidence: Math.max(0, Math.min(100, confidence)),
        source,
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
  options: {
    query?: string;
    project?: string | null;
    limit?: number;
    /** Include superseded and disputed memories (for admin/debug views). Default false. */
    includeInactive?: boolean;
  } = {}
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
    if (!options.includeInactive) {
      memories = filterActiveHeads(memories);
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
/**
 * Filter memories to only active, non-disputed heads of supersession chains.
 */
function filterActiveHeads(memories: Memory[]): Memory[] {
  const activeHeads: Memory[] = [];

  for (const memory of memories) {
    // Skip disputed memories entirely
    if (memory.validation_status === "disputed") continue;
    // Skip superseded memories (not the head of the chain)
    if (memory.superseded_by) continue;
    // Skip stale (superseded/outdated) memories
    if (memory.validation_status === "stale") continue;

    activeHeads.push(memory);
  }

  return activeHeads;
}

export async function retrieveRelevantMemories(
  userId: string,
  query: string,
  options: { project?: string | null; limit?: number } = {}
): Promise<Memory[]> {
  const all = await listMemories(userId, {
    project: options.project ?? undefined
  });
  const active = filterActiveHeads(all);
  return selectRelevantMemories(active, query, {
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
    confidence?: number;
    source?: MemorySource;
    validation_status?: ValidationStatus;
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
  if (patch.confidence !== undefined) {
    const conf = Math.round(patch.confidence);
    if (!Number.isFinite(conf) || conf < 0 || conf > 100) return { ok: false, reason: "confidence" };
    update.confidence = conf;
  }
  if (patch.source !== undefined) {
    if (!isMemorySource(patch.source)) return { ok: false, reason: "source" };
    update.source = patch.source;
  }
  if (patch.validation_status !== undefined) {
    if (!isValidationStatus(patch.validation_status)) return { ok: false, reason: "validation_status" };
    update.validation_status = patch.validation_status;
  }

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

/**
 * Supersede a memory with a new one, creating a chain.
 * The old memory gets superseded_by pointing to the new one, and validation_status becomes 'stale'.
 * The new memory is created with source='user_explicit' (or inferred if specified).
 */
export async function supersedeMemory(
  userId: string,
  oldId: string,
  newContent: string,
  options: {
    kind?: MemoryKind;
    importance?: number;
    project?: string | null;
    pinned?: boolean;
    source?: MemorySource;
    sourceConversationId?: string | null;
  } = {}
): Promise<{ ok: true; oldMemory: Memory; newMemory: Memory } | { ok: false; reason: string }> {
  if (!isConfigured()) return { ok: false, reason: "unavailable" };

  const content = newContent.replace(/\s+/g, " ").trim();
  if (!content) return { ok: false, reason: "empty" };
  if (containsSecret(content)) return { ok: false, reason: "secret" };

  const kind = isMemoryKind(options.kind) ? options.kind : "fact";
  const source = isMemorySource(options.source) ? options.source : "user_explicit";
  const metadata: Record<string, unknown> = {};
  if (options.project) metadata.project = options.project;

  try {
    const supabase = await client();

    // First, verify the old memory exists and belongs to the user
    const { data: oldData, error: oldError } = await supabase
      .from("bdm_memories")
      .select("*")
      .eq("id", oldId)
      .eq("user_id", userId)
      .single();

    if (oldError || !oldData) {
      return { ok: false, reason: "not_found" };
    }
    const oldMemory = oldData as Memory;

    // Create the new memory
    const { data: newData, error: newError } = await supabase
      .from("bdm_memories")
      .insert({
        user_id: userId,
        kind,
        content: content.slice(0, 4000),
        importance: clampImportance(options.importance ?? oldMemory.importance),
        confidence: Math.min(100, oldMemory.confidence + 5), // slight confidence boost for explicit replacement
        source,
        pinned: Boolean(options.pinned ?? oldMemory.pinned),
        metadata,
        source_conversation_id: options.sourceConversationId ?? null
      })
      .select("*")
      .single();

    if (newError || !newData) {
      console.error("BDM memory: supersede insert failed", newError?.message);
      return { ok: false, reason: "error" };
    }
    const newMemory = newData as Memory;

    // Update the old memory to point to the new one
    const { error: updateError } = await supabase
      .from("bdm_memories")
      .update({
        superseded_by: newMemory.id,
        superseded_at: new Date().toISOString(),
        validation_status: "stale",
        updated_at: new Date().toISOString()
      })
      .eq("id", oldId)
      .eq("user_id", userId);

    if (updateError) {
      console.error("BDM memory: supersede update failed", updateError.message);
      // The new memory was created but the link failed; not ideal but not catastrophic
    }

    return { ok: true, oldMemory, newMemory };
  } catch (err) {
    console.error("BDM memory: supersede threw", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Validate or dispute a memory (user-confirmed fact).
 */
export async function validateMemory(
  userId: string,
  id: string,
  status: ValidationStatus
): Promise<{ ok: true; memory: Memory } | { ok: false; reason: string }> {
  if (!isConfigured()) return { ok: false, reason: "unavailable" };
  if (!isValidationStatus(status)) return { ok: false, reason: "invalid_status" };

  try {
    const supabase = await client();
    const { data, error } = await supabase
      .from("bdm_memories")
      .update({
        validation_status: status,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error || !data) {
      console.error("BDM memory: validate failed", error?.message);
      return { ok: false, reason: "error" };
    }
    return { ok: true, memory: data as Memory };
  } catch (err) {
    console.error("BDM memory: validate threw", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Get the full supersession chain for a memory (ancestors and descendants).
 * Returns the chain ordered from oldest to newest.
 */
export async function getMemoryProvenance(
  userId: string,
  id: string
): Promise<Memory[]> {
  if (!isConfigured()) return [];

  try {
    const supabase = await client();

    // First get the target memory
    const { data: target, error: targetError } = await supabase
      .from("bdm_memories")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (targetError || !target) return [];

    const chain: Memory[] = [target as Memory];
    let current = target as Memory;

    // Walk forward (superseded_by)
    while (current.superseded_by) {
      const { data: next, error } = await supabase
        .from("bdm_memories")
        .select("*")
        .eq("id", current.superseded_by)
        .eq("user_id", userId)
        .single();
      if (error || !next) break;
      chain.push(next as Memory);
      current = next as Memory;
    }

    // Walk backward (find memories that point to this one)
    // We need to find all memories where superseded_by = id, then their predecessors, etc.
    const visited = new Set<string>([id]);
    let searching = true;
    while (searching) {
      searching = false;
      const { data: preds, error } = await supabase
        .from("bdm_memories")
        .select("*")
        .eq("superseded_by", chain[0].id)
        .eq("user_id", userId);
      if (error || !preds || preds.length === 0) break;

      for (const pred of preds as Memory[]) {
        if (!visited.has(pred.id)) {
          chain.unshift(pred);
          visited.add(pred.id);
          searching = true;
        }
      }
    }

    return chain;
  } catch (err) {
    console.error("BDM memory: provenance threw", err);
    return [];
  }
}

/**
 * Run deduplication scan and return proposed merge groups for user approval.
 */
export async function scanDuplicates(
  userId: string,
  options: { project?: string | null } = {}
): Promise<{ groups: string[][]; memories: Map<string, Memory> }> {
  if (!isConfigured()) return { groups: [], memories: new Map() };

  try {
    const supabase = await client();
    let query = supabase
      .from("bdm_memories")
      .select("*")
      .eq("user_id", userId);

    if (options.project) {
      query = query.eq("metadata->>project", options.project);
    }

    const { data, error } = await query;
    if (error || !data) return { groups: [], memories: new Map() };

    const memories = data as Memory[];
    const memMap = new Map<string, Memory>(memories.map((m) => [m.id, m]));
    const groups = findDuplicateGroups(memories);

    return { groups, memories: memMap };
  } catch (err) {
    console.error("BDM memory: scanDuplicates threw", err);
    return { groups: [], memories: new Map() };
  }
}

/**
 * Run compaction preview for a project (or global).
 */
export async function previewCompaction(
  userId: string,
  options: { project?: string | null } = {}
): Promise<{ summaryContent: string; supersededIds: string[] } | null> {
  if (!isConfigured()) return null;

  try {
    const supabase = await client();
    let query = supabase
      .from("bdm_memories")
      .select("*")
      .eq("user_id", userId);

    if (options.project) {
      query = query.eq("metadata->>project", options.project);
    } else {
      // Global only: metadata->>project IS NULL
      query = query.is("metadata->>project", null);
    }

    const { data, error } = await query;
    if (error || !data) return null;

    const memories = data as Memory[];
    return compactMemories(memories, options.project);
  } catch (err) {
    console.error("BDM memory: previewCompaction threw", err);
    return null;
  }
}

/**
 * Execute an approved compaction: create summary memory, supersede old ones.
 */
export async function executeCompaction(
  userId: string,
  summaryContent: string,
  supersededIds: string[],
  options: { project?: string | null; kind?: MemoryKind } = {}
): Promise<{ ok: true; summaryMemory: Memory; supersededCount: number } | { ok: false; reason: string }> {
  if (!isConfigured()) return { ok: false, reason: "unavailable" };
  if (supersededIds.length === 0) return { ok: false, reason: "empty" };

  const content = summaryContent.replace(/\s+/g, " ").trim();
  if (!content) return { ok: false, reason: "empty" };
  if (containsSecret(content)) return { ok: false, reason: "secret" };

  const kind = isMemoryKind(options.kind) ? options.kind : "summary";
  const metadata: Record<string, unknown> = {};
  if (options.project) metadata.project = options.project;
  metadata.compacted_from = supersededIds;
  metadata.compacted_at = new Date().toISOString();

  try {
    const supabase = await client();

    // Create the summary memory
    const { data: summaryData, error: summaryError } = await supabase
      .from("bdm_memories")
      .insert({
        user_id: userId,
        kind,
        content: content.slice(0, 4000),
        importance: 50,
        confidence: 70,
        source: "inferred",
        pinned: false,
        metadata,
        source_conversation_id: null
      })
      .select("*")
      .single();

    if (summaryError || !summaryData) {
      console.error("BDM memory: compaction insert failed", summaryError?.message);
      return { ok: false, reason: "error" };
    }
    const summaryMemory = summaryData as Memory;

    // Update all superseded memories to point to the summary
    const { error: updateError } = await supabase
      .from("bdm_memories")
      .update({
        superseded_by: summaryMemory.id,
        superseded_at: new Date().toISOString(),
        validation_status: "stale",
        updated_at: new Date().toISOString()
      })
      .in("id", supersededIds)
      .eq("user_id", userId);

    if (updateError) {
      console.error("BDM memory: compaction update failed", updateError.message);
      return { ok: false, reason: "error" };
    }

    return { ok: true, summaryMemory, supersededCount: supersededIds.length };
  } catch (err) {
    console.error("BDM memory: executeCompaction threw", err);
    return { ok: false, reason: "error" };
  }
}

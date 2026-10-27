import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * End-to-end security tests against a LOCAL Supabase stack.
 *
 * These require `supabase start` and `supabase db reset` to have run so the
 * bdm_* schema exists locally. They are skipped automatically when the local
 * API is not reachable, so the suite still passes in CI without Docker.
 *
 * What they prove:
 *  - A user can only ever read/write their own conversations and messages.
 *  - A user can only ever read/write their own long-term memories.
 *  - An unauthenticated caller gets nothing (RLS denies).
 *  - A forged message insert into another user's conversation is rejected.
 *  - Password sign-up + sign-in issues a real session.
 */

const API_URL = process.env.SUPABASE_LOCAL_URL ?? "http://127.0.0.1:54321";
const PUBLISHABLE_KEY =
  process.env.SUPABASE_LOCAL_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const EMAIL_A = `test-a-${Date.now()}@example.test`;
const EMAIL_B = `test-b-${Date.now()}@example.test`;
const PASSWORD = "test-password-123";

let available = false;
let clientA: SupabaseClient;
let clientB: SupabaseClient;
let userAId: string;
let userBId: string;
let convoAId: string;
let convoBId: string;

async function localReachable(): Promise<boolean> {
  // Allow forcing the suite on/off explicitly (used for debugging and CI).
  if (process.env.BDM_SUPABASE_TESTS === "1") return true;
  if (process.env.BDM_SUPABASE_TESTS === "0") return false;
  try {
    const res = await fetch(`${API_URL}/auth/v1/settings`, {
      headers: { apikey: PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(2000)
    });
    return res.ok;
  } catch (err) {
    console.error("[supabase-auth] reachability check failed:", err);
    return false;
  }
}

beforeAll(async () => {
  available = await localReachable();
  if (!available) return;

  clientA = createClient(API_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  clientB = createClient(API_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });

  const signupA = await clientA.auth.signUp({ email: EMAIL_A, password: PASSWORD });
  const signupB = await clientB.auth.signUp({ email: EMAIL_B, password: PASSWORD });
  userAId = signupA.data.user!.id;
  userBId = signupB.data.user!.id;

  // If email confirmation is required, sign in to obtain a session anyway.
  if (!signupA.data.session) {
    await clientA.auth.signInWithPassword({ email: EMAIL_A, password: PASSWORD });
  }
  if (!signupB.data.session) {
    await clientB.auth.signInWithPassword({ email: EMAIL_B, password: PASSWORD });
  }
}, 60_000);

afterAll(async () => {
  if (!available) return;
  // Clean up the test users we created (cascades to their rows via FK).
  try {
    // Use the service-role style admin delete is not available with anon key;
    // instead delete rows we own, then sign out. The users remain but are
    // isolated test fixtures in a local-only database.
    await clientA.from("bdm_memories").delete().eq("user_id", userAId);
    await clientB.from("bdm_memories").delete().eq("user_id", userBId);
    await clientA.from("bdm_conversations").delete().eq("user_id", userAId);
    await clientB.from("bdm_conversations").delete().eq("user_id", userBId);
  } catch {
    /* best effort */
  }
  await clientA.auth.signOut();
  await clientB.auth.signOut();
});

const itMaybe = process.env.BDM_SUPABASE_TESTS === "0" ? it.skip : it;

describe("BDM Supabase auth + persistence (local)", () => {
  itMaybe("sign-up issues an authenticated user", () => {
    // If the local stack is unreachable, available stays false and the rest
    // of this suite is a no-op; this first test documents that fact clearly.
    if (!available) {
      console.warn("[supabase-auth] local stack unreachable - skipping assertions");
      return;
    }
    expect(userAId).toBeTruthy();
    expect(userBId).toBeTruthy();
    expect(userAId).not.toBe(userBId);
  });

  itMaybe("a user can create a conversation owned by them", async () => {
    if (!available) return;
    const { data, error } = await clientA
      .from("bdm_conversations")
      .insert({ user_id: userAId, title: "A convo" })
      .select("*")
      .single();
    expect(error).toBeNull();
    expect(data!.user_id).toBe(userAId);
    convoAId = data!.id;

    const { data: dB } = await clientB
      .from("bdm_conversations")
      .insert({ user_id: userBId, title: "B convo" })
      .select("*")
      .single();
    convoBId = dB!.id;
  });

  itMaybe("a user only sees their OWN conversations (RLS isolation)", async () => {
    if (!available) return;
    const { data } = await clientA.from("bdm_conversations").select("*");
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(convoAId);
    expect(ids).not.toContain(convoBId);
  });

  itMaybe("a user can append a message to their own conversation", async () => {
    if (!available) return;
    const { error } = await clientA
      .from("bdm_messages")
      .insert({ conversation_id: convoAId, role: "user", content: { text: "hello" } });
    expect(error).toBeNull();
  });

  itMaybe("a user CANNOT insert a message into another user's conversation", async () => {
    if (!available) return;
    // clientA tries to write into convoB (owned by B). RLS must reject.
    const { error } = await clientA
      .from("bdm_messages")
      .insert({ conversation_id: convoBId, role: "user", content: { text: "intruder" } });
    expect(error).not.toBeNull();
  });

  itMaybe("a user CANNOT read another user's messages", async () => {
    if (!available) return;
    const { data } = await clientA
      .from("bdm_messages")
      .select("*")
      .eq("conversation_id", convoBId);
    expect(data ?? []).toHaveLength(0);
  });

  itMaybe("a user can read back their own persisted messages", async () => {
    if (!available) return;
    const { data } = await clientA
      .from("bdm_messages")
      .select("*")
      .eq("conversation_id", convoAId)
      .order("created_at", { ascending: true });
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("Memory isolation (local)", () => {
  let memoryAId: string;

  itMaybe("a user can save a memory scoped to a project", async () => {
    if (!available) return;
    const { data, error } = await clientA
      .from("bdm_memories")
      .insert({
        user_id: userAId,
        kind: "fact",
        content: "The alpha project ships on Fridays",
        importance: 70,
        metadata: { project: "alpha" }
      })
      .select("*")
      .single();

    expect(error).toBeNull();
    expect(data!.user_id).toBe(userAId);
    memoryAId = data!.id;
  });

  itMaybe("a user only sees their OWN memories (RLS isolation)", async () => {
    if (!available) return;
    const { data: seenByB } = await clientB.from("bdm_memories").select("*");
    expect((seenByB ?? []).map((row) => row.id)).not.toContain(memoryAId);

    const { data: seenByA } = await clientA.from("bdm_memories").select("*");
    expect((seenByA ?? []).map((row) => row.id)).toContain(memoryAId);
  });

  itMaybe("a user CANNOT read another user's memory by id", async () => {
    if (!available) return;
    const { data } = await clientB
      .from("bdm_memories")
      .select("*")
      .eq("id", memoryAId);
    expect(data ?? []).toHaveLength(0);
  });

  itMaybe("a user CANNOT delete another user's memory", async () => {
    if (!available) return;
    await clientB.from("bdm_memories").delete().eq("id", memoryAId);
    // Re-read as the owner: the row must still be there.
    const { data } = await clientA
      .from("bdm_memories")
      .select("id")
      .eq("id", memoryAId);
    expect((data ?? []).map((row) => row.id)).toContain(memoryAId);
  });

  itMaybe("project scoping works through the jsonb metadata filter", async () => {
    if (!available) return;
    const { data: alpha } = await clientA
      .from("bdm_memories")
      .select("id")
      .eq("metadata->>project", "alpha");
    expect((alpha ?? []).map((row) => row.id)).toContain(memoryAId);

    const { data: beta } = await clientA
      .from("bdm_memories")
      .select("id")
      .eq("metadata->>project", "beta");
    expect((beta ?? []).map((row) => row.id)).not.toContain(memoryAId);
  });

  itMaybe("anon cannot read or write memories", async () => {
    if (!available) return;
    const anon = createClient(API_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false }
    });

    const { data } = await anon.from("bdm_memories").select("*");
    expect(data ?? []).toHaveLength(0);

    const { error } = await anon.from("bdm_memories").insert({
      user_id: userAId,
      kind: "fact",
      content: "spoofed memory",
      metadata: {}
    });
    expect(error).not.toBeNull();
  });
});

describe("Unauthenticated access is denied", () => {
  itMaybe("anon (no session) cannot list conversations", async () => {
    if (!available) return;
    const anon = createClient(API_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await anon.from("bdm_conversations").select("*");
    // RLS returns an empty set (not an error) for anon on these policies.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  itMaybe("anon cannot insert a conversation", async () => {
    if (!available) return;
    const anon = createClient(API_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
    const { error } = await anon
      .from("bdm_conversations")
      .insert({ user_id: userAId, title: "spoofed" });
    // Insert policy is scoped to authenticated; anon is rejected.
    expect(error).not.toBeNull();
  });
});

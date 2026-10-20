import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import type { Conversation } from "../../../lib/bdm-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List the signed-in user's conversations (most recent first).
 * RLS guarantees only the caller's own rows are returned.
 */
export async function GET(): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("bdm_conversations")
    .select("*")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: "Could not load conversations" }, { status: 500 });
  }

  return NextResponse.json({ conversations: (data ?? []) as Conversation[] });
}

/** Create a new conversation for the signed-in user. */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let title = "New conversation";
  try {
    const body = (await request.json()) as { title?: unknown };
    if (typeof body.title === "string" && body.title.trim()) {
      title = body.title.trim().slice(0, 200);
    }
  } catch {
    // empty body is fine; use default title
  }

  const { data, error } = await supabase
    .from("bdm_conversations")
    .insert({ user_id: auth.user.id, title })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "Could not create conversation" }, { status: 500 });
  }

  return NextResponse.json({ conversation: data as Conversation });
}

/**
 * Delete every conversation owned by the caller.
 *
 * bdm_messages cascades from bdm_conversations, so history and messages are
 * removed together. Long-term memories are a separate store and are NOT
 * touched here - clearing history must not silently wipe what the user
 * explicitly asked BDM to remember.
 */
export async function DELETE(): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: owned, error: selectError } = await supabase
    .from("bdm_conversations")
    .select("id")
    .eq("user_id", auth.user.id);

  if (selectError) {
    return NextResponse.json(
      { error: "Could not clear conversation history" },
      { status: 500 }
    );
  }

  const ids = (owned ?? []).map((row) => (row as { id: string }).id);
  if (ids.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  const { error } = await supabase
    .from("bdm_conversations")
    .delete()
    .eq("user_id", auth.user.id);

  if (error) {
    return NextResponse.json(
      { error: "Could not clear conversation history" },
      { status: 500 }
    );
  }

  return NextResponse.json({ deleted: ids.length });
}

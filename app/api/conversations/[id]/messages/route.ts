import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import type { Message, MessageRole } from "../../../../../lib/bdm-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Load the messages for one conversation, oldest first.
 * RLS ensures the caller can only read conversations they own; a message
 * belonging to another user's conversation returns 404 (no rows).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("bdm_messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Could not load messages" }, { status: 500 });
  }

  return NextResponse.json({ messages: (data ?? []) as Message[] });
}

/**
 * Append a message to a conversation. The insert policy checks that the
 * conversation belongs to the caller, so a forged conversation_id for
 * someone else's conversation is rejected by the database.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let role: MessageRole;
  let content: unknown;
  let model: string | null = null;
  try {
    const body = (await request.json()) as {
      role?: unknown;
      content?: unknown;
      model?: unknown;
    };
    if (body.role !== "user" && body.role !== "assistant" && body.role !== "system") {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    role = body.role;
    content = body.content;
    if (typeof body.model === "string") model = body.model;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("bdm_messages")
    .insert({ conversation_id: id, role, content, model })
    .select("*")
    .single();

  if (error) {
    // RLS rejection surfaces here as a policy violation.
    return NextResponse.json(
      { error: "Could not save message" },
      { status: error.code === "42501" ? 403 : 500 }
    );
  }

  // Bump the conversation's updated_at so it sorts to the top of the list.
  await supabase
    .from("bdm_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ message: data as Message });
}

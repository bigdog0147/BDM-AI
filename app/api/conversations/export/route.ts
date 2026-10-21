import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/conversations/export
 *
 * Exports all conversations and messages for the signed-in user as JSON.
 * This is a user-initiated backup; no auth beyond the existing session.
 */
export async function GET(): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Fetch all conversations for the user
    const { data: conversations, error: convError } = await supabase
      .from("bdm_conversations")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("updated_at", { ascending: false });

    if (convError) {
      return NextResponse.json({ error: "Could not load conversations" }, { status: 500 });
    }

    // Fetch messages for each conversation
    const conversationIds = conversations?.map((c) => c.id) ?? [];
    let allMessages: Record<string, unknown>[] = [];

    if (conversationIds.length > 0) {
      const { data: messages, error: msgError } = await supabase
        .from("bdm_messages")
        .select("*")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: true });

      if (msgError) {
        return NextResponse.json({ error: "Could not load messages" }, { status: 500 });
      }
      allMessages = messages ?? [];
    }

    // Fetch memories for the user
    const { data: memories } = await supabase
      .from("bdm_memories")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      user: { id: auth.user.id, email: auth.user.email },
      conversations: conversations ?? [],
      messages: allMessages,
      memories: memories ?? [],
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="bdm-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    console.error("Export error", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
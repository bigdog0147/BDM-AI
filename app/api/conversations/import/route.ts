import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ImportData {
  version: number;
  conversations?: Record<string, unknown>[];
  messages?: Record<string, unknown>[];
  memories?: Record<string, unknown>[];
}

/**
 * POST /api/conversations/import
 *
 * Imports conversations, messages, and memories from a previously exported JSON.
 * Only imports data for the currently signed-in user.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = (await request.json()) as ImportData;

    if (!body || body.version !== 1) {
      return NextResponse.json({ error: "Invalid or unsupported export format" }, { status: 400 });
    }

    const userId = auth.user.id;
    const importedConversations: string[] = [];
    let importedMessages = 0;
    let importedMemories = 0;

    // Import conversations
    if (body.conversations && Array.isArray(body.conversations)) {
      for (const conv of body.conversations) {
        // Verify this conversation belongs to the user (or is being imported for them)
        // We create new conversation IDs to avoid conflicts
        const { data, error } = await supabase
          .from("bdm_conversations")
          .insert({
            user_id: userId,
            title: conv.title ?? "Imported conversation",
            model_hint: conv.model_hint ?? null,
            metadata: conv.metadata ?? {},
            archived_at: conv.archived_at ?? null,
            created_at: conv.created_at ?? new Date().toISOString(),
            updated_at: conv.updated_at ?? new Date().toISOString(),
          })
          .select("id")
          .single();

        if (error || !data) {
          console.error("Import: failed to create conversation", error?.message);
          continue;
        }

        const oldId = conv.id;
        const newId = data.id;

        importedConversations.push(newId);

        // Import messages for this conversation
        const relevantMessages = (body.messages ?? []).filter((m) => m.conversation_id === oldId);
        if (relevantMessages.length > 0) {
          const messagesToInsert = relevantMessages.map((msg) => ({
            conversation_id: newId,
            role: msg.role,
            content: msg.content,
            model: msg.model ?? null,
            tool_name: msg.tool_name ?? null,
            tool_call_id: msg.tool_call_id ?? null,
            token_usage: msg.token_usage ?? {},
            created_at: msg.created_at ?? new Date().toISOString(),
          }));

          const { error: msgError } = await supabase
            .from("bdm_messages")
            .insert(messagesToInsert);

          if (msgError) {
            console.error("Import: failed to insert messages", msgError.message);
          } else {
            importedMessages += messagesToInsert.length;
          }
        }
      }
    }

    // Import memories
    if (body.memories && Array.isArray(body.memories)) {
      for (const mem of body.memories) {
        const { error } = await supabase
          .from("bdm_memories")
          .upsert(
            {
              user_id: userId,
              kind: mem.kind ?? "fact",
              content: mem.content,
              importance: mem.importance ?? 1,
              pinned: mem.pinned ?? false,
              metadata: mem.metadata ?? {},
              created_at: mem.created_at ?? new Date().toISOString(),
              updated_at: mem.updated_at ?? new Date().toISOString(),
            },
            { onConflict: "user_id,kind,content", ignoreDuplicates: true }
          );

        if (!error) importedMemories++;
      }
    }

    return NextResponse.json({
      ok: true,
      imported: {
        conversations: importedConversations.length,
        messages: importedMessages,
        memories: importedMemories,
      },
    });
  } catch (error) {
    console.error("Import error", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
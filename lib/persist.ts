import { createSupabaseServerClient } from "./supabase-server";
import { generateReply } from "./ai";

interface PersistArgs {
  userMessage: string;
  assistantText: string;
  model: string;
  conversationId: string | null;
  /**
   * Optional structured metadata for the assistant turn (for example the
   * sources behind a research answer). Stored inside the existing jsonb
   * `content` column, so no schema change is needed.
   */
  assistantSources?: unknown;
}

/**
 * Generate a concise conversation title from the first exchange.
 * Falls back to truncated user message if generation fails.
 */
async function generateConversationTitle(
  userMessage: string,
  assistantText: string
): Promise<string> {
  try {
    const result = await generateReply({
      system: "Summarize this conversation in 3-5 words. No punctuation. No quotes. Just the title.",
      user: `User: ${userMessage}\nAssistant: ${assistantText}`,
    });
    const title = result.text.trim().replace(/[."']/g, "").slice(0, 60);
    return title || userMessage.trim().slice(0, 60);
  } catch {
    return userMessage.trim().slice(0, 60);
  }
}

/**
 * Best-effort persistence of one chat turn to bdm_conversations/bdm_messages.
 *
 * Returns the conversation id used, or null when nothing was saved:
 *  - Supabase is not configured (local-only / tests)
 *  - no user is signed in (anonymous chat is allowed, just not saved)
 *  - any error occurs (persistence must NEVER break the chat itself)
 *
 * Every failure path returns null and logs server-side only - never to the
 * browser. Row Level Security still governs all writes, so a caller can only
 * ever save into conversations they own.
 */
export async function persistTurn(args: PersistArgs): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Not configured -> skip entirely (no Supabase client, no cookies() call).
  if (!url || !key) return null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null; // anonymous chat works but is not saved

    let conversationId = args.conversationId;

    // First turn of a new conversation: create it with a generated title.
    if (!conversationId) {
      const title = await generateConversationTitle(args.userMessage, args.assistantText);
      const { data, error } = await supabase
        .from("bdm_conversations")
        .insert({ user_id: auth.user.id, title })
        .select("id")
        .single();
      if (error || !data) {
        console.error("BDM persist: create conversation failed", error?.message);
        return null;
      }
      conversationId = data.id as string;
    }

    // Save both turns. content is jsonb: { text }.
    const { error: msgError } = await supabase.from("bdm_messages").insert([
      {
        conversation_id: conversationId,
        role: "user",
        content: { text: args.userMessage }
      },
      {
        conversation_id: conversationId,
        role: "assistant",
        content: args.assistantSources
          ? { text: args.assistantText, sources: args.assistantSources }
          : { text: args.assistantText },
        model: args.model
      }
    ]);
    if (msgError) {
      // The conversation row exists even if the message insert failed.
      console.error("BDM persist: insert messages failed", msgError.message);
      return conversationId;
    }

    // Bump updated_at so the conversation sorts to the top of the list.
    await supabase
      .from("bdm_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    return conversationId;
  } catch (err) {
    // Includes cookies() being called outside a request scope. Never fatal.
    console.error("BDM persist: unexpected error", err);
    return null;
  }
}

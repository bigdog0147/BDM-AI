import { createSupabaseServerClient } from "./supabase-server";

/**
 * Best-effort audit trail for tool-like actions (image generation, research).
 *
 * Records metadata only - never prompts, audio, images, or credentials.
 * Mirrors the persistence pattern used for chat turns: any failure is
 * swallowed and logged server-side, because auditing must never break the
 * action the user asked for.
 */
export async function recordAuditEvent(input: {
  userId: string;
  eventType: string;
  action: string;
  status: "success" | "failure";
  conversationId?: string | null;
  toolKey?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("bdm_audit_events").insert({
      user_id: input.userId,
      event_type: input.eventType,
      action: input.action,
      status: input.status,
      conversation_id: input.conversationId ?? null,
      tool_key: input.toolKey ?? null,
      details: input.details ?? {}
    });
    if (error) {
      console.error("BDM audit: insert failed", error.message);
    }
  } catch (error) {
    console.error("BDM audit: insert threw", error);
  }
}

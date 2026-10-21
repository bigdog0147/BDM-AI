import { createClient } from "@supabase/supabase-js";
import type { NormalizedEmailEvent } from "./webhooks";

/**
 * Persistence for verified webhook events.
 *
 * Uses the service role because `bdm_email_events` has RLS enabled with no
 * policies. That key is server-only and must never be exposed with a
 * NEXT_PUBLIC_ prefix. Without it the webhook still verifies and acknowledges
 * events, but reports `stored: false` instead of pretending they were saved.
 */

export function webhookStorageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

export type RecordResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; reason: "not_configured" | "failed" };

export async function recordEmailEvent(
  event: NormalizedEmailEvent
): Promise<RecordResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return { ok: false, reason: "not_configured" };

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data, error } = await supabase
      .from("bdm_email_events")
      .upsert(
        {
          provider: event.provider,
          event_id: event.eventId,
          event_type: event.eventType,
          email_id: event.emailId,
          occurred_at: event.occurredAt
        },
        { onConflict: "event_id", ignoreDuplicates: true }
      )
      .select("id");

    if (error) {
      // Only the error code: payloads may contain customer content.
      console.error("BDM email webhook: insert failed", error.code);
      return { ok: false, reason: "failed" };
    }

    // No returned row means the id was already stored (idempotent replay).
    return { ok: true, duplicate: (data?.length ?? 0) === 0 };
  } catch (error) {
    console.error(
      "BDM email webhook: insert threw",
      error instanceof Error ? error.name : "unknown"
    );
    return { ok: false, reason: "failed" };
  }
}

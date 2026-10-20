import { NextResponse } from "next/server";
import { aiStatus } from "../../../lib/ai";
import { currentUser } from "../../../lib/auth";
import { emailStatus } from "../../../lib/email";
import { webhookStorageConfigured } from "../../../lib/email-events";
import { imageStatus } from "../../../lib/image-provider";
import { quotaStatus } from "../../../lib/quota";
import { searchStatus } from "../../../lib/search";
import { transcriptionStatus } from "../../../lib/transcribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redacted capability status for the UI.
 *
 * Every field is a boolean, a provider name, a model name, or a limit.
 * No key, token, URL with credentials, or secret value is ever included.
 */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  const voice = transcriptionStatus();
  const email = emailStatus();

  return NextResponse.json({
    signedIn: Boolean(user),
    memory: {
      // Memory needs both authentication and the Supabase data layer.
      available: Boolean(user) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
    },
    ai: aiStatus(),
    search: searchStatus(),
    images: imageStatus(),
    voice: {
      provider: voice.provider,
      model: voice.model,
      configured: voice.configured,
      retention: voice.retention,
      maxBytes: voice.maxBytes,
      maxDurationSeconds: voice.maxDurationSeconds
    },
    email: {
      provider: email.provider,
      configured: email.configured,
      enabled: email.enabled,
      apiKeyConfigured: email.apiKeyConfigured,
      fromConfigured: email.fromConfigured,
      maxSubjectLength: email.maxSubjectLength,
      maxBodyLength: email.maxBodyLength,
      webhook: {
        configured: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()),
        storage: webhookStorageConfigured() ? "service_role" : "not_configured"
      }
    },
    quotas: quotaStatus()
  });
}

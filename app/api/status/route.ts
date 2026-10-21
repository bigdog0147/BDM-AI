import { NextResponse } from "next/server";
import { aiStatus } from "../../../lib/ai";
import { currentUser } from "../../../lib/auth";
import { environmentStatus } from "../../../lib/diagnostics";
import { emailStatus } from "../../../lib/email";
import { webhookStorageConfigured } from "../../../lib/email-events";
import {
  getGoogleConfig,
  googleCallbackUrl,
  requestOrigin
} from "../../../lib/google-auth";
import {
  findGoogleLinkForUser,
  googleIdentityStoreConfigured
} from "../../../lib/google-identity-store";
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
export async function GET(request: Request): Promise<Response> {
  const user = await currentUser();
  const voice = transcriptionStatus();
  const email = emailStatus();
  const googleConfig = getGoogleConfig(request.url);
  const googleStore = googleIdentityStoreConfigured();
  const googleLink =
    user && googleStore ? await findGoogleLinkForUser(user.id) : null;

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
    google: {
      // Both the OAuth client and the server-only identity guard are required.
      configured: googleConfig.ok && googleStore,
      credentialsConfigured: googleConfig.ok,
      identityStoreConfigured: googleStore,
      callbackUrl: googleCallbackUrl(request.url),
      // The origin to register as an authorized JavaScript origin.
      origin: requestOrigin(request),
      linked: Boolean(user && googleLink?.ok && googleLink.value),
      providers: user?.providers ?? []
    },
    quotas: quotaStatus(),
    // Variable NAMES and presence only. A value never reaches the browser.
    environment: environmentStatus()
  });
}

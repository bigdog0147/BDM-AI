import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only persistence for Google identity links.
 *
 * `bdm_google_identities` has RLS enabled with no policies, so only the
 * service-role client can read or write it. The table is an account-linking
 * guard, not a second user store: users and sessions still live in Supabase
 * Auth.
 */

export interface GoogleLink {
  googleSub: string;
  userId: string;
  email: string;
}

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_configured" | "failed" };

export type CreateGoogleUserResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "exists" | "not_configured" | "failed" };

function serviceConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

export function googleIdentityStoreConfigured(): boolean {
  return serviceConfig() !== null;
}

function adminClient(): SupabaseClient | null {
  const config = serviceConfig();
  if (!config) return null;
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function isMissingTable(error: { code?: string | null } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function isDuplicate(error: { code?: string | null } | null): boolean {
  return error?.code === "23505";
}

function isExistingUserError(error: {
  code?: string | null;
  message?: string | null;
  status?: number | null;
} | null): boolean {
  if (!error) return false;
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    error.code === "email_exists" ||
    error.status === 422 ||
    text.includes("already") ||
    text.includes("registered") ||
    (text.includes("exists") && text.includes("user"))
  );
}

export async function findGoogleLink(
  googleSub: string
): Promise<StoreResult<GoogleLink | null>> {
  const supabase = adminClient();
  if (!supabase) return { ok: false, reason: "not_configured" };

  const { data, error } = await supabase
    .from("bdm_google_identities")
    .select("google_sub,user_id,email")
    .eq("google_sub", googleSub)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      reason: isMissingTable(error) ? "not_configured" : "failed"
    };
  }
  if (!data) return { ok: true, value: null };

  return {
    ok: true,
    value: {
      googleSub: data.google_sub as string,
      userId: data.user_id as string,
      email: data.email as string
    }
  };
}

export async function findGoogleLinkForUser(
  userId: string
): Promise<StoreResult<GoogleLink | null>> {
  const supabase = adminClient();
  if (!supabase) return { ok: false, reason: "not_configured" };

  const { data, error } = await supabase
    .from("bdm_google_identities")
    .select("google_sub,user_id,email")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      reason: isMissingTable(error) ? "not_configured" : "failed"
    };
  }
  if (!data) return { ok: true, value: null };

  return {
    ok: true,
    value: {
      googleSub: data.google_sub as string,
      userId: data.user_id as string,
      email: data.email as string
    }
  };
}

export async function createGoogleLink(input: {
  googleSub: string;
  userId: string;
  email: string;
}): Promise<StoreResult<GoogleLink>> {
  const supabase = adminClient();
  if (!supabase) return { ok: false, reason: "not_configured" };

  const { error } = await supabase.from("bdm_google_identities").insert({
    google_sub: input.googleSub,
    user_id: input.userId,
    email: input.email
  });

  if (error) {
    return {
      ok: false,
      reason:
        isMissingTable(error) || isDuplicate(error) ? "not_configured" : "failed"
    };
  }

  return {
    ok: true,
    value: {
      googleSub: input.googleSub,
      userId: input.userId,
      email: input.email
    }
  };
}

export async function touchGoogleLink(googleSub: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) return;
  await supabase
    .from("bdm_google_identities")
    .update({ last_login_at: new Date().toISOString() })
    .eq("google_sub", googleSub);
}

export async function deleteGoogleLink(googleSub: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) return;
  await supabase
    .from("bdm_google_identities")
    .delete()
    .eq("google_sub", googleSub);
}

/**
 * Create the Supabase Auth user for a first-time, Google-verified email.
 * A duplicate-email error is returned as `exists`; the caller must refuse to
 * link that existing account unless it was already linked explicitly.
 */
export async function createGoogleUser(input: {
  email: string;
  name: string | null;
  picture: string | null;
}): Promise<CreateGoogleUserResult> {
  const supabase = adminClient();
  if (!supabase) return { ok: false, reason: "not_configured" };

  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    email_confirm: true,
    user_metadata: {
      full_name: input.name,
      avatar_url: input.picture,
      auth_provider: "google"
    }
  });

  if (error) {
    return {
      ok: false,
      reason: isExistingUserError(error) ? "exists" : "failed"
    };
  }
  if (!data.user) return { ok: false, reason: "failed" };
  return { ok: true, userId: data.user.id };
}

/** Best-effort rollback when linking fails immediately after user creation. */
export async function deleteGoogleUser(userId: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) return;
  await supabase.auth.admin.deleteUser(userId);
}

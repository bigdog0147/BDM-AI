import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface GitHubLink {
  githubId: string;
  userId: string;
  email: string;
}

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_configured" | "failed" };

export type CreateGitHubUserResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "exists" | "not_configured" | "failed" };

function serviceConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

export function githubIdentityStoreConfigured(): boolean {
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

export async function findGitHubLink(
  githubId: string
): Promise<StoreResult<GitHubLink | null>> {
  const supabase = adminClient();
  if (!supabase) return { ok: false, reason: "not_configured" };
  const { data, error } = await supabase
    .from("bdm_github_identities")
    .select("github_id,user_id,email")
    .eq("github_id", githubId)
    .maybeSingle();
  if (error) return { ok: false, reason: isMissingTable(error) ? "not_configured" : "failed" };
  if (!data) return { ok: true, value: null };
  return { ok: true, value: { githubId: data.github_id as string, userId: data.user_id as string, email: data.email as string } };
}

export async function findGitHubLinkForUser(
  userId: string
): Promise<StoreResult<GitHubLink | null>> {
  const supabase = adminClient();
  if (!supabase) return { ok: false, reason: "not_configured" };
  const { data, error } = await supabase
    .from("bdm_github_identities")
    .select("github_id,user_id,email")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, reason: isMissingTable(error) ? "not_configured" : "failed" };
  if (!data) return { ok: true, value: null };
  return { ok: true, value: { githubId: data.github_id as string, userId: data.user_id as string, email: data.email as string } };
}

export async function createGitHubLink(input: {
  githubId: string;
  userId: string;
  email: string;
}): Promise<StoreResult<GitHubLink>> {
  const supabase = adminClient();
  if (!supabase) return { ok: false, reason: "not_configured" };
  const { data, error } = await supabase.from("bdm_github_identities").insert([{
    github_id: input.githubId,
    user_id: input.userId,
    email: input.email.trim().toLowerCase()
  }]).select("github_id,user_id,email").single();
  if (error) return { ok: false, reason: "failed" };
  return { ok: true, value: { githubId: data.github_id as string, userId: data.user_id as string, email: data.email as string } };
}

export async function deleteGitHubLink(githubId: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) return;
  await supabase.from("bdm_github_identities").delete().eq("github_id", githubId);
}

export async function touchGitHubLink(githubId: string): Promise<void> {
  // No-op placeholder; add updated_at if needed.
}

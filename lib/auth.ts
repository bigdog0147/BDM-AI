import { createSupabaseServerClient } from "./supabase-server";

export interface AuthUser {
  id: string;
  email?: string | null;
}

/**
 * The signed-in user, or null.
 *
 * Returns null (rather than throwing) when Supabase is unconfigured or the
 * session is absent, so every caller can keep its "anonymous still works"
 * path without a try/catch of its own.
 */
export async function currentUser(): Promise<AuthUser | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}

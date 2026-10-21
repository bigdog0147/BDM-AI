import { createSupabaseServerClient } from "./supabase-server";

export interface AuthUser {
  id: string;
  email?: string | null;
  /** Supabase identity providers, e.g. ["email", "google"]. */
  providers?: string[];
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

    const providers = Array.from(
      new Set(
        (data.user.identities ?? [])
          .map((identity) => identity.provider)
          .filter((provider): provider is string => Boolean(provider))
      )
    );

    if (providers.length === 0) {
      const fromMetadata = data.user.app_metadata?.providers;
      if (Array.isArray(fromMetadata)) {
        for (const provider of fromMetadata) {
          if (typeof provider === "string" && provider) providers.push(provider);
        }
      }
    }

    return {
      id: data.user.id,
      email: data.user.email,
      providers
    };
  } catch {
    return null;
  }
}

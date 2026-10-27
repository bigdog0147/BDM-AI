import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-only Supabase client.
 *
 * Kept separate from `supabase-server.ts` because that module imports
 * `next/headers` and therefore cannot be bundled into a client component.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase environment variables are not configured");
  }

  return createBrowserClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}

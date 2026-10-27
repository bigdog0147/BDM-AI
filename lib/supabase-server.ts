import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createBrowserClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client bound to the request's auth cookies.
 *
 * Uses @supabase/ssr so the session lives in httpOnly cookies rather than
 * localStorage - the secure pattern for Next.js App Router. Only the
 * publishable (anon) key is ever used here; there is no service-role key in
 * this codebase. All data access is governed by Row Level Security.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase environment variables are not configured");
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll is called from a Server Component where cookies are
          // read-only. This is safe to ignore when middleware refreshes
          // the session (see middleware.ts).
        }
      }
    }
  });
}

/**
 * Browser-side Supabase client. Persists the session in cookies via the
 * browser variant of @supabase/ssr semantics (localStorage is avoided).
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

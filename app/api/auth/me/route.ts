import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Return the currently authenticated user, or null. */
export async function GET(): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return NextResponse.json({ user: null });
    }

    const providers = Array.from(
      new Set(
        (data.user.identities ?? [])
          .map((identity) => identity.provider)
          .filter((provider): provider is string => Boolean(provider))
      )
    );

    return NextResponse.json({
      user: { id: data.user.id, email: data.user.email, providers }
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}

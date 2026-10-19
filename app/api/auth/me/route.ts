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

    return NextResponse.json({
      user: { id: data.user.id, email: data.user.email }
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}

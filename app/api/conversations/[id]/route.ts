import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delete one conversation owned by the caller.
 *
 * RLS on bdm_conversations guarantees the row belongs to the signed-in user,
 * so a forged id simply affects zero rows and the request is reported as a
 * 404. Messages cascade with the conversation; saved memories are a separate
 * store and are not touched.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("bdm_conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: "Could not delete the conversation" },
      { status: 500 }
    );
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ deleted: data.length });
}

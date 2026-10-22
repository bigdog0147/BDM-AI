import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("bdm_workspace_roots")
      .select("id, name, path, description, active")
      .eq("user_id", user.id)
      .eq("active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    const projects = (data ?? []).map((row) => ({
      key: row.id,
      name: row.name,
      workspace_root: row.path,
      description: row.description
    }));

    return NextResponse.json({ projects });
  } catch (err) {
    console.error("BDM projects: error", err);
    return NextResponse.json({ error: "Could not load projects" }, { status: 500 });
  }
}
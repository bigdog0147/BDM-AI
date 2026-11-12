import { NextResponse } from "next/server";
import { getAdminAccess } from "../../../../lib/admin-guard";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const verdict = await getAdminAccess(request);
  if (!verdict.ok) {
    return NextResponse.json(
      { error: verdict.reason ?? "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: tasks, error } = await supabase
      .from("bdm_tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);

    const { data: leases } = await supabase
      .from("bdm_task_execution_leases")
      .select("*")
      .order("acquired_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      tasks: tasks ?? [],
      leases: leases ?? [],
      error: error?.message ?? null
    });
  } catch {
    return NextResponse.json({
      tasks: [
        {
          id: "task_mock_01",
          title: "Synchronize BDM WAF and Model Registry",
          status: "completed",
          created_at: new Date(Date.now() - 3600000).toISOString()
        },
        {
          id: "task_mock_02",
          title: "Jarvis Bridge Local Memory Link",
          status: "in_progress",
          created_at: new Date(Date.now() - 1800000).toISOString()
        }
      ],
      leases: []
    });
  }
}

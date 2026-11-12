import { NextResponse } from "next/server";
import { getAdminAccess } from "../../../../lib/admin-guard";
import {
  readJarvisExternalStore,
  appendLearningToJarvis,
  appendMemoryToJarvis,
  JARVIS_STORAGE_PATH
} from "../../../../lib/jarvis-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const verdict = await getAdminAccess(request);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason ?? "Unauthorized" }, { status: 401 });
  }

  const result = readJarvisExternalStore();
  if (!result.ok || !result.data) {
    return NextResponse.json({
      connected: false,
      storagePath: JARVIS_STORAGE_PATH,
      error: result.error ?? "External memory file not accessible"
    });
  }

  return NextResponse.json({
    connected: true,
    storagePath: result.path,
    identity: result.data.identity,
    stats: {
      memoriesCount: result.data.memories?.length ?? 0,
      tasksCount: result.data.tasks?.length ?? 0,
      learningsCount: result.data.continuousLearning?.length ?? 0,
      lastUpdated: result.data.updatedAt
    },
    recentMemories: (result.data.memories ?? []).slice(0, 10),
    recentLearnings: (result.data.continuousLearning ?? []).slice(0, 5)
  });
}

export async function POST(request: Request): Promise<Response> {
  const verdict = await getAdminAccess(request);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { action, text, category, userText, assistantText } = body;

    if (action === "add_memory" && typeof text === "string" && text.trim()) {
      const ok = appendMemoryToJarvis(text.trim(), category || "bdm_workspace");
      return NextResponse.json({ ok, action: "add_memory" });
    }

    if (action === "log_learning" && userText && assistantText) {
      const ok = appendLearningToJarvis({ userText, assistantText, toolsUsed: ["bdm_web"] });
      return NextResponse.json({ ok, action: "log_learning" });
    }

    // Default action: Touch & sync heartbeat
    const result = readJarvisExternalStore();
    return NextResponse.json({
      ok: result.ok,
      action: "sync_check",
      stats: result.data
        ? {
            memoriesCount: result.data.memories?.length ?? 0,
            tasksCount: result.data.tasks?.length ?? 0,
            learningsCount: result.data.continuousLearning?.length ?? 0
          }
        : null
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

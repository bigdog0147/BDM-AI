import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth";
import { listToolPermissions, getAllToolPermissions } from "../../../lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const [userPerms, allPerms] = await Promise.all([
      listToolPermissions(user.id),
      getAllToolPermissions(user.id)
    ]);

    return NextResponse.json({
      permissions: userPerms,
      all: allPerms
    });
  } catch (err) {
    console.error("BDM permissions: error", err);
    return NextResponse.json({ error: "Could not load permissions" }, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { toolKey?: unknown; level?: unknown } | null;
  const toolKey = typeof payload?.toolKey === "string" ? payload.toolKey.trim() : "";
  const level = payload?.level;

  if (!toolKey) {
    return NextResponse.json({ error: "toolKey is required" }, { status: 400 });
  }
  if (level !== "deny" && level !== "ask" && level !== "allow") {
    return NextResponse.json(
      { error: "level must be 'deny', 'ask', or 'allow'" },
      { status: 400 }
    );
  }

  try {
    const { setToolPermission } = await import("../../../lib/permissions");
    const ok = await setToolPermission(user.id, toolKey, level);
    if (!ok) {
      return NextResponse.json({ error: "Could not set permission" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, toolKey, level });
  } catch (err) {
    console.error("BDM permissions: set error", err);
    return NextResponse.json({ error: "Could not set permission" }, { status: 500 });
  }
}
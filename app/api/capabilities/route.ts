import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth";
import { getCapabilities, checkAllCapabilities } from "../../../lib/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const capabilities = getCapabilities();
    const checks = await checkAllCapabilities();

    const merged = capabilities.map((cap) => {
      const check = checks.find((c) => c.capability.key === cap.key);
      return {
        ...cap,
        available: check?.available ?? false,
        reason: check?.reason
      };
    });

    return NextResponse.json({ capabilities: merged });
  } catch (err) {
    console.error("BDM capabilities: error", err);
    return NextResponse.json({ error: "Could not load capabilities" }, { status: 500 });
  }
}
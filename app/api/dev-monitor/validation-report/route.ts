import { NextResponse } from "next/server";

import { devMonitorPageGuard } from "../../../../lib/dev-monitor-guard";
import { storeValidationReport, type DevMonitorValidationReport } from "../../../../lib/dev-monitor";

export const dynamic = "force-dynamic";

const validationReportKeys = new Set(["buildCompletedAt", "eslintErrors", "eslintWarnings", "tscErrors", "testPassed", "testSkipped", "testTotal"]);

export async function POST(request: Request): Promise<Response> {
  const access = await devMonitorPageGuard(request);
  if (!access) return new Response(null, { status: 404 });

  const expectedKey = process.env.BDM_DEV_MONITOR_REPORT_KEY?.trim();
  if (expectedKey) {
    const supplied = request.headers.get("x-bdm-dev-report-key")?.trim();
    if (supplied !== expectedKey) {
      return NextResponse.json({ error: "invalid report key" }, { status: 403 });
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "invalid report" }, { status: 400 });
  }

  const source = payload as Record<string, unknown>;
  const report: DevMonitorValidationReport = {};
  for (const key of validationReportKeys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      (report as Record<string, unknown>)[key] = source[key];
    }
  }

  try {
    storeValidationReport(report);
  } catch {
    return NextResponse.json({ error: "invalid report fields" }, { status: 400 });
  }

  return NextResponse.json({ accepted: true });
}

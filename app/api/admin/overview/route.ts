import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "node:fs";
import { getAdminAccess } from "../../../../lib/admin-guard";
import { aiStatus } from "../../../../lib/ai";
import { emailStatus } from "../../../../lib/email";
import { environmentStatus } from "../../../../lib/diagnostics";
import { getGoogleConfig } from "../../../../lib/google-auth";
import { googleIdentityStoreConfigured } from "../../../../lib/google-identity-store";
import { githubIdentityStoreConfigured } from "../../../../lib/github-identity-store";
import { imageStatus } from "../../../../lib/image-provider";
import { quotaStatus } from "../../../../lib/quota";
import { searchStatus } from "../../../../lib/search";
import { transcriptionStatus } from "../../../../lib/transcribe";
import { requestOrigin } from "../../../../lib/http";
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

  const origin = requestOrigin(request);
  const mem = process.memoryUsage();

  // Test Supabase connectivity
  let supabaseConnected = false;
  let supabaseLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    const supabase = await createSupabaseServerClient();
    const { count } = await supabase.from("bdm_conversations").select("*", { count: "exact", head: true });
    supabaseLatencyMs = Date.now() - t0;
    supabaseConnected = count !== null && count !== undefined;
  } catch {
    supabaseConnected = false;
  }

  // Test Jarvis Bridge connectivity
  let jarvisBridgeConnected = false;
  let jarvisTelemetry: Record<string, unknown> | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const res = await fetch("http://127.0.0.1:8787/identity", {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      jarvisBridgeConnected = true;
      jarvisTelemetry = await res.json();
    }
  } catch {
    jarvisBridgeConnected = false;
  }

  // External memory drive check
  const externalDrivePath = "E:\\AI\\Shared\\Memory\\bigdog-jarvis-memory.json";
  let externalMemoryInfo = {
    exists: false,
    path: externalDrivePath,
    sizeBytes: 0,
    lastModified: null as string | null,
    memoriesCount: 0,
    tasksCount: 0,
    learningsCount: 0
  };

  try {
    if (existsSync(externalDrivePath)) {
      const stats = statSync(externalDrivePath);
      const content = JSON.parse(readFileSync(externalDrivePath, "utf-8"));
      externalMemoryInfo = {
        exists: true,
        path: externalDrivePath,
        sizeBytes: stats.size,
        lastModified: stats.mtime.toISOString(),
        memoriesCount: Array.isArray(content.memories) ? content.memories.length : 0,
        tasksCount: Array.isArray(content.tasks) ? content.tasks.length : 0,
        learningsCount: Array.isArray(content.continuousLearning) ? content.continuousLearning.length : 0
      };
    }
  } catch {
    // Keep defaults
  }

  const voice = transcriptionStatus();
  const email = emailStatus();
  const googleConfig = getGoogleConfig(origin);
  const quotas = quotaStatus();
  const envSummary = environmentStatus();

  return NextResponse.json({
    admin: {
      role: verdict.role,
      user: verdict.user ? { id: verdict.user.id, email: verdict.user.email } : null,
      isDev: verdict.isDev
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
        rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10
      },
      environment: process.env.NODE_ENV || "development"
    },
    security: {
      firewall: {
        status: "ACTIVE",
        mode: "enforcing",
        protections: [
          "WAF Signature Filter (SQLi, XSS, Path Traversal)",
          "Dotfile & Sensitive File Block (.env, .git)",
          "Sliding-Window Rate Limiter (/api/* and /api/auth/*)",
          "Production Dev-Monitor Lockout",
          "HSTS & Secure Security Headers"
        ]
      },
      privateViewProtected: true
    },
    services: {
      supabase: {
        configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        connected: supabaseConnected,
        latencyMs: supabaseLatencyMs,
        url: process.env.NEXT_PUBLIC_SUPABASE_URL ? "Configured" : "Missing"
      },
      googleOAuth: {
        configured: Boolean(googleConfig.ok && googleConfig.config.clientId && googleConfig.config.clientSecret),
        storeConfigured: googleIdentityStoreConfigured()
      },
      githubAuth: {
        storeConfigured: githubIdentityStoreConfigured()
      },
      email: {
        provider: email.provider,
        configured: email.configured,
        apiKeySet: email.apiKeyConfigured,
        fromAddressSet: email.fromConfigured
      },
      search: searchStatus(),
      images: imageStatus(),
      voice: {
        provider: voice.provider,
        model: voice.model,
        configured: voice.configured
      },
      aiGateway: aiStatus(),
      jarvisBridge: {
        connected: jarvisBridgeConnected,
        endpoint: "ws://127.0.0.1:8787",
        telemetry: jarvisTelemetry
      }
    },
    externalMemory: externalMemoryInfo,
    quotas,
    diagnosticsSummary: {
      requiredConfigured: envSummary.filter((e) => e.kind === "required" && e.present).length,
      requiredTotal: envSummary.filter((e) => e.kind === "required").length,
      optionalConfigured: envSummary.filter((e) => e.kind !== "required" && e.present).length
    }
  });
}

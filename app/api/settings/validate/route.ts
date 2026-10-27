import { NextResponse } from "next/server";

/**
 * Lightweight environment configuration validation.
 * Returns diagnostics; never includes raw secret values.
 */
export const runtime = "nodejs";

const AI_FALLBACK_TYPES = ["none", "openai", "ollama"];

export async function POST(request: Request): Promise<Response> {
  const warnings: string[] = [];
  let errors: string[] = [];

  // Database connection
  const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!dbUrl) {
    errors.push("Supabase URL is not configured.");
  } else {
    const j = dbUrl.match(/^postgresql:\/\/[^:]+@([^:\/]+):(\d+)\/([^?]+)/);
    if (!j || !j[2]) {
      warnings.push("Supabase URL looks malformed; verify project reference.");
    }
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || serviceKey === "sb_secret_dummy") {
    errors.push("Supabase service role key is not configured.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  if (!process.env.OPENAI_API_KEY) {
    warnings.push("OPENAI_API_KEY is unset; paid features may be unavailable.");
  }

  const fallback = process.env.AI_FALLBACK_PROVIDER;
  if (fallback && fallback !== "none" && !AI_FALLBACK_TYPES.includes(fallback)) {
    warnings.push(`AI_FALLBACK_PROVIDER=${fallback} is not a recognized value (expected none | openai | ollama).`);
  }

  return NextResponse.json({
    ok: errors.length === 0,
    errors,
    warnings,
    env: {
      openaiApiKeySet: !!process.env.OPENAI_API_KEY,
      openaiModel: process.env.OPENAI_MODEL || undefined,
      fallbackProvider: process.env.AI_FALLBACK_PROVIDER || undefined,
      webSearchEnabled: process.env.BDM_WEB_SEARCH_ENABLED || false,
    },
  });
}

import { NextResponse } from "next/server";
import { checkAuthEmailBudget } from "../../../../lib/auth-email";
import { requestOrigin } from "../../../../lib/http";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

/**
 * POST /api/auth/resend-verification
 *
 * Body: { email: string }
 *
 * Supabase Auth generates and verifies the confirmation token; this route
 * only asks it to resend. The response is deliberately identical whether or
 * not the address exists, so it cannot be used to enumerate accounts.
 */
export async function POST(request: Request): Promise<Response> {
  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: "Authentication is not configured on the server." },
      { status: 503 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawEmail = (payload as { email?: unknown } | null)?.email;
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const budget = await checkAuthEmailBudget({ request, email, kind: "verify" });
  if (!budget.ok) {
    return NextResponse.json(
      {
        error:
          "Too many verification requests for this address. Please wait before trying again.",
        resetAt: budget.resetAt
      },
      {
        status: 429,
        headers: { "retry-after": String(budget.retryAfterSeconds) }
      }
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${requestOrigin(request)}/auth` }
    });
    if (error) {
      // Status/code only: the address and the upstream message stay out of logs.
      console.error(
        "BDM resend verification failed",
        error.status ?? "unknown",
        error.code ?? "unknown"
      );
    }
  } catch (error) {
    console.error(
      "BDM resend verification threw",
      error instanceof Error ? error.name : "unknown"
    );
  }

  return NextResponse.json({
    ok: true,
    accepted: true,
    // Honest: false means the database counters were unavailable and only the
    // in-process guard ran.
    durable: budget.durable
  });
}

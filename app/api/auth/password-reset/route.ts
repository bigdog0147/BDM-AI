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
 * POST /api/auth/password-reset
 *
 * Body: { email: string }
 *
 * Supabase Auth owns the recovery token and the reset page session. This
 * route only requests the email, behind a separate durable budget from
 * verification emails.
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

  const budget = await checkAuthEmailBudget({ request, email, kind: "reset" });
  if (!budget.ok) {
    return NextResponse.json(
      {
        error:
          "Too many password reset requests for this address. Please wait before trying again.",
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${requestOrigin(request)}/auth/reset`
    });
    if (error) {
      console.error(
        "BDM password reset request failed",
        error.status ?? "unknown",
        error.code ?? "unknown"
      );
    }
  } catch (error) {
    console.error(
      "BDM password reset request threw",
      error instanceof Error ? error.name : "unknown"
    );
  }

  return NextResponse.json({
    ok: true,
    accepted: true,
    durable: budget.durable
  });
}

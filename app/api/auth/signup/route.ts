import { NextResponse } from "next/server";
import { checkAuthEmailBudget } from "../../../../lib/auth-email";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign up with email + password. Supabase sends a confirmation email unless
 * email confirmation is disabled in the project's Auth settings.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      email?: unknown;
      password?: unknown;
    };

    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Same independent budgets as the resend route: signing up sends the same
    // confirmation email, so it must count too. When the durable store is
    // unavailable the check degrades instead of blocking account creation.
    const budget = await checkAuthEmailBudget({ request, email, kind: "verify" });
    if (!budget.ok) {
      return NextResponse.json(
        {
          error:
            "Too many confirmation emails for this address. Please wait before trying again.",
          resetAt: budget.resetAt
        },
        {
          status: 429,
          headers: { "retry-after": String(budget.retryAfterSeconds) }
        }
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      user: data.user ? { id: data.user.id, email: data.user.email } : null,
      // When email confirmation is on, session is null until confirmed.
      needsConfirmation: !data.session
    });
  } catch {
    return NextResponse.json({ error: "Sign up failed" }, { status: 500 });
  }
}

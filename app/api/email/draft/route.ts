import { NextResponse } from "next/server";
import { aiStatus, generateReply } from "../../../../lib/ai";
import { currentUser } from "../../../../lib/auth";
import { parseEmailDraft } from "../../../../lib/email";
import { safeError, safeErrorStatus, safeLogDetail } from "../../../../lib/errors";
import { consumeUserQuota, quotaLimits, retryAfterSeconds } from "../../../../lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INSTRUCTION = 1000;

const SYSTEM_PROMPT = [
  "You draft one email for a user to review before sending.",
  "Return exactly two parts and nothing else:",
  "Subject: <one line, no more than 120 characters>",
  "Body:",
  "<the plain-text email body>",
  "Do not invent recipient addresses. Do not add commentary, markdown fences, or notes.",
  "Keep the tone professional and concise unless the instruction says otherwise."
].join("\n");

/**
 * POST /api/email/draft
 *
 * Body: { instruction: string }
 *
 * Returns a draft only. This endpoint never sends and never calls Resend, so
 * an AI-composed message cannot leave the app without explicit user review
 * and confirmation through /api/email/send.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawInstruction = (payload as { instruction?: unknown } | null)?.instruction;
  const instruction = typeof rawInstruction === "string" ? rawInstruction.trim() : "";

  if (instruction.length < 3) {
    return NextResponse.json(
      { error: "Describe the email you want (at least 3 characters)" },
      { status: 400 }
    );
  }
  if (instruction.length > MAX_INSTRUCTION) {
    return NextResponse.json(
      { error: `The instruction is too long (${MAX_INSTRUCTION} characters maximum)` },
      { status: 400 }
    );
  }

  if (!aiStatus().configured) {
    return NextResponse.json(
      { error: "AI drafting is not configured on the server.", configured: false },
      { status: 503 }
    );
  }

  const quota = await consumeUserQuota(
    "email.draft",
    "day",
    quotaLimits().emailDraftDaily
  );
  if (!quota.ok) {
    if (quota.reason === "limited") {
      return NextResponse.json(
        { error: `Daily draft limit (${quota.limit}) reached.`, resetAt: quota.resetAt },
        { status: 429, headers: { "retry-after": String(retryAfterSeconds(quota.resetAt)) } }
      );
    }
    return NextResponse.json(
      {
        error:
          "The usage quota store is not available, so drafting is disabled to prevent unbounded spend.",
        reason: "quota_unavailable"
      },
      { status: 503 }
    );
  }

  try {
    const generated = await generateReply({
      system: SYSTEM_PROMPT,
      user: instruction
    });
    const draft = parseEmailDraft(generated.text);

    return NextResponse.json({
      draft: true,
      subject: draft.subject,
      body: draft.body,
      model: generated.model,
      provider: generated.provider,
      // Stated explicitly: nothing has been sent.
      sent: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("BDM email draft error", safeLogDetail(error));
    return NextResponse.json(
      { error: safeError(message), sent: false },
      { status: safeErrorStatus(message) }
    );
  }
}

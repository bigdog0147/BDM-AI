/**
 * Server-only transactional email via Resend.
 *
 * There is no SDK dependency: this is one documented HTTP endpoint, which
 * keeps the bundle small and makes the provider trivially mockable in tests.
 *
 * Safety rules enforced here:
 *  - disabled unless BDM_EMAIL_ENABLED is exactly "true" (explicit opt-in)
 *  - requires both RESEND_API_KEY and RESEND_FROM_EMAIL
 *  - one recipient per message, validated, and CR/LF is rejected everywhere
 *    so a caller cannot inject headers
 *  - the API key is never logged or returned
 */

export const MAX_RECIPIENT_LENGTH = 254;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 10_000;

const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export interface EmailStatus {
  provider: "resend" | null;
  /** Explicit opt-in switch. */
  enabled: boolean;
  apiKeyConfigured: boolean;
  fromConfigured: boolean;
  /** True only when all three requirements are present. */
  configured: boolean;
  maxSubjectLength: number;
  maxBodyLength: number;
}

export function emailStatus(): EmailStatus {
  const enabled = process.env.BDM_EMAIL_ENABLED?.trim().toLowerCase() === "true";
  const apiKeyConfigured = Boolean(process.env.RESEND_API_KEY?.trim());
  const fromConfigured = Boolean(process.env.RESEND_FROM_EMAIL?.trim());

  return {
    provider: enabled && apiKeyConfigured && fromConfigured ? "resend" : null,
    enabled,
    apiKeyConfigured,
    fromConfigured,
    configured: enabled && apiKeyConfigured && fromConfigured,
    maxSubjectLength: MAX_SUBJECT_LENGTH,
    maxBodyLength: MAX_BODY_LENGTH
  };
}

export type EmailValidation =
  | { ok: true; to: string; subject: string; body: string }
  | {
      ok: false;
      reason:
        | "bad_recipient"
        | "bad_subject"
        | "bad_body"
        | "too_long"
        | "too_many_recipients";
    };

/**
 * Validate a single outgoing message.
 *
 * A comma or semicolon is treated as an attempt to send to several
 * recipients at once, which this build deliberately does not support.
 */
export function validateEmailInput(input: {
  to?: unknown;
  subject?: unknown;
  body?: unknown;
}): EmailValidation {
  if (typeof input.to !== "string") return { ok: false, reason: "bad_recipient" };

  const to = input.to.trim();
  if (!to || to.length > MAX_RECIPIENT_LENGTH) {
    return { ok: false, reason: "bad_recipient" };
  }
  if (/[,;]/.test(to)) return { ok: false, reason: "too_many_recipients" };
  if (CONTROL_CHARS.test(to) || !EMAIL_PATTERN.test(to)) {
    return { ok: false, reason: "bad_recipient" };
  }

  if (typeof input.subject !== "string") return { ok: false, reason: "bad_subject" };
  const subject = input.subject.trim();
  if (!subject || CONTROL_CHARS.test(subject)) {
    return { ok: false, reason: "bad_subject" };
  }
  if (subject.length > MAX_SUBJECT_LENGTH) return { ok: false, reason: "too_long" };

  if (typeof input.body !== "string") return { ok: false, reason: "bad_body" };
  const body = input.body.trim();
  if (!body) return { ok: false, reason: "bad_body" };
  if (body.length > MAX_BODY_LENGTH) return { ok: false, reason: "too_long" };

  return { ok: true, to, subject, body };
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "unauthorized"
        | "rate_limited"
        | "rejected"
        | "timeout"
        | "failed";
    };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 15_000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain-text body plus a minimal HTML alternative. */
export function renderEmailHtml(body: string): string {
  const escaped = escapeHtml(body).replace(/\n/g, "<br>");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#20242c">${escaped}</div>`;
}

/**
 * Send one message. Callers must already have checked configuration,
 * authorization, and quota; this function does not.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<SendEmailResult> {
  const status = emailStatus();
  if (!status.configured) return { ok: false, reason: "not_configured" };

  const apiKey = process.env.RESEND_API_KEY?.trim() as string;
  const from = process.env.RESEND_FROM_EMAIL?.trim() as string;

  // The configured sender is the only sender: a caller cannot override it.
  if (CONTROL_CHARS.test(from)) return { ok: false, reason: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.body,
        html: renderEmailHtml(input.body)
      }),
      signal: controller.signal
    });

    if (response.ok) {
      let id: string | null = null;
      try {
        const data = (await response.json()) as { id?: unknown };
        id = typeof data.id === "string" ? data.id : null;
      } catch {
        // A 2xx with an unreadable body still means the provider accepted it.
      }
      return { ok: true, id };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "unauthorized" };
    }
    if (response.status === 429) return { ok: false, reason: "rate_limited" };
    if (response.status >= 400 && response.status < 500) {
      return { ok: false, reason: "rejected" };
    }
    return { ok: false, reason: "failed" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse a model response into a subject and body.
 *
 * Models are inconsistent about the requested shape, so this accepts
 * "Subject: ..." plus "Body:" anywhere, and degrades to using the whole
 * response as the body rather than failing the request.
 */
export function parseEmailDraft(text: string): { subject: string; body: string } {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");

  const subjectIdx = lines.findIndex((line) => /^\s*subject\s*:/i.test(line));
  const bodyIdx = lines.findIndex(
    (line, index) =>
      /^\s*body\s*:\s*$/i.test(line) && (subjectIdx < 0 || index > subjectIdx)
  );

  let subject = "";
  let body = normalized;

  if (subjectIdx >= 0) {
    // The first line is the subject; indented follow-ups belong to it too.
    const parts = [lines[subjectIdx].replace(/^\s*subject\s*:\s*/i, "").trim()];
    let index = subjectIdx + 1;
    while (
      index < lines.length &&
      /^\s+\S/.test(lines[index]) &&
      !/^\s*body\s*:\s*$/i.test(lines[index])
    ) {
      parts.push(lines[index].trim());
      index += 1;
    }

    subject = parts
      .join(" ")
      .replace(CONTROL_CHARS, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (bodyIdx >= 0) {
      body = lines.slice(bodyIdx + 1).join("\n").trim();
    } else if (index < lines.length) {
      body = lines.slice(index).join("\n").trim();
    }
  } else if (bodyIdx >= 0) {
    body = lines.slice(bodyIdx + 1).join("\n").trim();
  }

  if (subject.length > MAX_SUBJECT_LENGTH) {
    subject = subject.slice(0, MAX_SUBJECT_LENGTH).trim();
  }
  if (body.length > MAX_BODY_LENGTH) body = body.slice(0, MAX_BODY_LENGTH);

  return {
    subject: subject || "Draft from BDM",
    body: body || normalized.slice(0, MAX_BODY_LENGTH)
  };
}

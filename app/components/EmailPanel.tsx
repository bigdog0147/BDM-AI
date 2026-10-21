"use client";

import { useState } from "react";

/**
 * Email composer with a mandatory review step.
 *
 * Two paths can fill the fields: typing, or "Draft with AI". Neither sends.
 * Sending requires opening the review block, seeing the exact recipient,
 * subject, and body, ticking the confirmation box, and pressing "Confirm
 * send" — which is the only action that posts `confirmed: true`.
 */
export default function EmailPanel({
  configured,
  onClose
}: {
  configured: boolean;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [instruction, setInstruction] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSend =
    configured &&
    to.trim().length > 3 &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    !sending;

  function editField(setter: (value: string) => void, value: string) {
    setter(value);
    // Any edit invalidates a previous review.
    setReviewing(false);
    setReviewed(false);
    setNotice(null);
  }

  async function draft() {
    const text = instruction.trim();
    if (text.length < 3 || drafting) return;

    setDrafting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/email/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: text })
      });
      const data = (await response.json()) as {
        subject?: string;
        body?: string;
        error?: string;
      };
      if (!response.ok || !data.body) {
        throw new Error(data.error || "The draft could not be created.");
      }
      setSubject(data.subject ?? "");
      setBody(data.body);
      setReviewing(false);
      setReviewed(false);
      setNotice(
        "Draft inserted. Nothing has been sent — check the recipient, then review and confirm."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "The draft could not be created.");
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (!canSend || !reviewed) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          subject,
          body,
          confirmed: true
        })
      });
      const data = (await response.json()) as { error?: string; id?: string };
      if (!response.ok) {
        throw new Error(data.error || "The email could not be sent.");
      }
      setNotice("Email sent.");
      setReviewing(false);
      setReviewed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The email could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel" aria-label="Send an email">
      <div className="panel-head">
        <strong>Email</strong>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {!configured && (
        <p className="notice">
          Email sending is not configured. Add <code>RESEND_API_KEY</code> and{" "}
          <code>RESEND_FROM_EMAIL</code> on the server and set{" "}
          <code>BDM_EMAIL_ENABLED=true</code>. Drafting with AI may still work.
        </p>
      )}

      <label className="field-label" htmlFor="email-to">
        Recipient
      </label>
      <input
        id="email-to"
        className="field"
        type="email"
        value={to}
        onChange={(event) => editField(setTo, event.target.value)}
        placeholder="name@example.com"
        autoComplete="off"
        maxLength={254}
      />

      <label className="field-label" htmlFor="email-subject">
        Subject
      </label>
      <input
        id="email-subject"
        className="field"
        type="text"
        value={subject}
        onChange={(event) => editField(setSubject, event.target.value)}
        placeholder="Subject line"
        maxLength={200}
      />

      <label className="field-label" htmlFor="email-body">
        Message
      </label>
      <textarea
        id="email-body"
        rows={8}
        value={body}
        onChange={(event) => editField(setBody, event.target.value)}
        placeholder="Write the email, or ask BDM to draft it below."
        maxLength={10_000}
      />

      <label className="field-label" htmlFor="email-instruction">
        Ask BDM to draft (optional)
      </label>
      <textarea
        id="email-instruction"
        rows={2}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder="e.g. A short note to the landlord asking for a repair date"
        maxLength={1000}
      />
      <div className="panel-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => void draft()}
          disabled={drafting || instruction.trim().length < 3}
        >
          {drafting ? "Drafting…" : "Draft with AI"}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          A draft is never sent automatically.
        </span>
      </div>

      {error && <p className="notice error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {!reviewing ? (
        <div className="panel-actions">
          <button
            type="button"
            onClick={() => {
              setReviewing(true);
              setReviewed(false);
              setNotice(null);
            }}
            disabled={!canSend}
          >
            Review and send
          </button>
        </div>
      ) : (
        <div className="notice">
          <strong>Confirm before sending</strong>
          <p className="hint" style={{ marginTop: 6 }}>
            To: {to.trim()}
            <br />
            Subject: {subject.trim()}
          </p>
          <div
            className="hint"
            style={{ whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}
          >
            {body}
          </div>
          <label className="hint" style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            I have reviewed the recipient, subject, and message.
          </label>
          <div className="panel-actions" style={{ marginTop: 8 }}>
            <button type="button" onClick={() => void send()} disabled={!reviewed || sending}>
              {sending ? "Sending…" : "Confirm send"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setReviewing(false);
                setReviewed(false);
              }}
              disabled={sending}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

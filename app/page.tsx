"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ChatMessage = { role: "user" | "assistant"; content: string };
type AuthUser = { id: string; email?: string } | null;

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hello. I’m BDM, your personal AI. What are we working on?" }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d: { user: AuthUser }) => {
        if (!cancelled) {
          setUser(d.user);
          setAuthChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When signed in, load the most recent conversation and its messages so a
  // page refresh restores history. Signed-out users see only the greeting.
  useEffect(() => {
    if (!user || historyLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const listRes = await fetch("/api/conversations");
        const listData = (await listRes.json()) as {
          conversations?: { id: string }[];
        };
        const first = listData.conversations?.[0];
        if (cancelled) return;
        if (!first) {
          setHistoryLoaded(true);
          return;
        }
        const msgRes = await fetch(`/api/conversations/${first.id}/messages`);
        const msgData = (await msgRes.json()) as {
          messages?: { role: string; content?: { text?: string } }[];
        };
        if (cancelled) return;
        const history: ChatMessage[] = (msgData.messages ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content?.text ?? ""
          }));
        setConversationId(first.id);
        setMessages(
          history.length
            ? history
            : [
                {
                  role: "assistant",
                  content: "Hello. I’m BDM, your personal AI. What are we working on?"
                }
              ]
        );
      } catch {
        // History load is best-effort; the greeting stays if it fails.
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, historyLoaded]);

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    setUser(null);
    setConversationId(null);
    setHistoryLoaded(false);
    setMessages([
      { role: "assistant", content: "Hello. I’m BDM, your personal AI. What are we working on?" }
    ]);
    router.refresh();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversationId })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "BDM request failed");

      // The server returns the conversation it saved into (null when not
      // signed in or persistence unavailable). Keep using it for the next turn.
      if (typeof data.conversationId === "string" && data.conversationId) {
        setConversationId(data.conversationId);
      }

      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.text || "I could not generate a response." }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: error instanceof Error ? `System error: ${error.message}` : "System error."
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="brand">BDM</div>
          <div className="subtitle">Personal AI</div>
        </div>
        <div className="status">
          {authChecked && user ? (
            <span className="auth-actions">
              <span className="auth-user">{user.email}</span>
              <button type="button" className="auth-btn" onClick={signOut}>
                Sign out
              </button>
            </span>
          ) : authChecked ? (
            <a href="/auth" className="auth-btn">
              Sign in
            </a>
          ) : (
            <span />
          )}
          {" "}
          Core online
        </div>
      </header>

      <section className="chat">
        {messages.map((message, index) => (
          <article key={index} className={`message ${message.role}`}>
            <div className="label">{message.role === "assistant" ? "BDM" : "You"}</div>
            <div>{message.content}</div>
          </article>
        ))}
        {busy && <article className="message assistant"><div className="label">BDM</div><div>Thinking…</div></article>}
      </section>

      <form className="composer" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask BDM anything…"
          rows={2}
        />
        <button type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </main>
  );
}

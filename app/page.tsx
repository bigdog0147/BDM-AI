"use client";

import { FormEvent, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hello. I'm BDM, your personal AI. What are we working on?" }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

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
        body: JSON.stringify({ message: text })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "BDM request failed");

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
        <div className="status"><span /> Core online</div>
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
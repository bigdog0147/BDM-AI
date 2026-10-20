"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MemoryPanel from "./components/MemoryPanel";
import ImagePanel, { type GeneratedImage } from "./components/ImagePanel";
import EmailPanel from "./components/EmailPanel";
import VoiceRecorder from "./components/VoiceRecorder";

type AuthUser = { id: string; email?: string } | null;

type Source = {
  index: number;
  title: string;
  url: string;
  domain: string;
  publishedDate?: string | null;
  snippet?: string;
};

type MemoryAction = {
  type: "saved" | "forgotten" | "blocked_secret" | "unavailable" | "not_found";
  count?: number;
  contents?: string[];
  memory?: { id: string; content: string; kind: string };
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  kind?: "chat" | "research" | "image" | "error";
  sources?: Source[];
  image?: GeneratedImage;
  memoryAction?: MemoryAction;
  memoriesUsed?: { id: string; content: string; kind: string }[];
  warning?: string;
};

type Status = {
  signedIn: boolean;
  memory: { available: boolean };
  ai: { provider: string; model: string | null; configured: boolean };
  search: { provider: string | null; configured: boolean };
  images: { provider: string | null; model: string | null; configured: boolean };
  voice: {
    provider: string | null;
    model: string | null;
    configured: boolean;
    retention: string;
    maxDurationSeconds: number;
  };
  email?: {
    provider: string | null;
    configured: boolean;
    enabled: boolean;
  };
};

const GREETING: ChatMessage = {
  role: "assistant",
  content: "Hello. I’m BDM, your personal AI. What are we working on?"
};

function memoryBadge(action: MemoryAction): { text: string; tone: string } {
  switch (action.type) {
    case "saved":
      return {
        text: `Saved to memory (${action.memory?.kind ?? "fact"})`,
        tone: "ok"
      };
    case "forgotten":
      return {
        text:
          action.count === 1
            ? "Forgot 1 memory"
            : `Forgot ${action.count ?? 0} memories`,
        tone: "ok"
      };
    case "blocked_secret":
      return { text: "Not saved — looks like a secret", tone: "warn" };
    case "unavailable":
      return { text: "Memory unavailable — nothing saved", tone: "warn" };
    case "not_found":
      return { text: "No matching memory found", tone: "warn" };
    default:
      return { text: "Memory action", tone: "" };
  }
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [researchMode, setResearchMode] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  // Capability status: provider names and booleans only, never key values.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((r) => r.json())
      .then((d: Status) => {
        if (!cancelled) setStatus(d);
      })
      .catch(() => {
        // Status is informational; the app still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Restore the most recent conversation on refresh.
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
          messages?: {
            role: string;
            content?: { text?: string; sources?: Source[] };
          }[];
        };
        if (cancelled) return;

        const history: ChatMessage[] = (msgData.messages ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content?.text ?? "",
            sources: Array.isArray(m.content?.sources)
              ? (m.content?.sources as Source[])
              : undefined
          }));

        setConversationId(first.id);
        setMessages(history.length ? history : [GREETING]);
      } catch {
        // Best-effort restore; the greeting stays if it fails.
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
    setMessages([GREETING]);
    setShowMemory(false);
    setShowImage(false);
    setShowVoice(false);
    setShowEmail(false);
    router.refresh();
  }

  function clearHistory() {
    setConversationId(null);
    setMessages([GREETING]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    // busy + ref together stop a double click from sending twice.
    if (!text || busy || sendingRef.current) return;
    sendingRef.current = true;

    setMessages((current) => [...current, { role: "user", content: text }]);
    setInput("");
    setBusy(true);

    try {
      if (researchMode) {
        const response = await fetch("/api/research", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: text, conversationId })
        });
        const data = (await response.json()) as {
          answer?: string;
          sources?: Source[];
          citations?: number[];
          missingCitations?: boolean;
          conversationId?: string | null;
          error?: string;
        };

        if (!response.ok || typeof data.answer !== "string") {
          // A synthesis failure can still carry real sources; show both the
          // error and what was actually found.
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              content: `System error: ${data.error || "Research failed."}`,
              kind: "error",
              sources: data.sources
            }
          ]);
          return;
        }

        if (typeof data.conversationId === "string" && data.conversationId) {
          setConversationId(data.conversationId);
        }

        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: data.answer as string,
            kind: "research",
            sources: data.sources,
            warning: data.missingCitations
              ? "The answer did not cite its sources. Treat the claims as unverified."
              : undefined
          }
        ]);
      } else {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text, conversationId })
        });
        const data = (await response.json()) as {
          text?: string;
          conversationId?: string | null;
          memoryAction?: MemoryAction;
          memoriesUsed?: { id: string; content: string; kind: string }[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "BDM request failed");
        }

        if (typeof data.conversationId === "string" && data.conversationId) {
          setConversationId(data.conversationId);
        }

        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: data.text || "I could not generate a response.",
            memoryAction: data.memoryAction,
            memoriesUsed: data.memoriesUsed
          }
        ]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? `System error: ${error.message}`
              : "System error.",
          kind: "error"
        }
      ]);
    } finally {
      setBusy(false);
      sendingRef.current = false;
    }
  }

  function useTranscript(text: string) {
    // Review happens in the composer: the transcript is not auto-sent.
    setInput((current) => (current ? `${current} ${text}` : text));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const voiceReady = status?.voice.configured ?? false;
  const imageReady = status?.images.configured ?? false;
  const researchReady = status?.search.configured ?? false;

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
              <button
                type="button"
                className="auth-btn"
                onClick={() => setShowMemory(true)}
                aria-haspopup="dialog"
              >
                Memory
              </button>
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
          )}{" "}
          <span className="status-dot" aria-hidden="true" />
          Core online
        </div>
      </header>

      {status && (
        <div className="capabilities" aria-label="Provider status">
          <span className={`chip ${status.ai.configured ? "ok" : "warn"}`}>
            AI: {status.ai.provider}
            {status.ai.model ? ` · ${status.ai.model}` : ""}
          </span>
          <span className={`chip ${status.search.configured ? "ok" : "muted"}`}>
            Research: {status.search.configured ? status.search.provider : "not configured"}
          </span>
          <span className={`chip ${status.images.configured ? "ok" : "muted"}`}>
            Images: {status.images.configured ? "ready" : "not configured"}
          </span>
          <span className={`chip ${status.voice.configured ? "ok" : "muted"}`}>
            Voice: {status.voice.configured ? "ready" : "not configured"}
          </span>
          <span className={`chip ${status.email?.configured ? "ok" : "muted"}`}>
            Email: {status.email?.configured ? "ready" : "not configured"}
          </span>
          {status.signedIn ? (
            <span className="chip ok">Memory: on</span>
          ) : (
            <span className="chip muted">Memory: sign in</span>
          )}
        </div>
      )}

      <section className="chat" aria-live="polite">
        {messages.map((message, index) => (
          <article
            key={index}
            className={`message ${message.role}${message.kind === "error" ? " error" : ""}`}
          >
            <div className="label">
              {message.role === "assistant" ? "BDM" : "You"}
              {message.kind === "research" && <span className="label-tag">research</span>}
            </div>
            <div className="message-text">{message.content}</div>

            {message.memoryAction && (
              <div
                className={`memory-badge ${memoryBadge(message.memoryAction).tone}`}
                role="status"
              >
                {memoryBadge(message.memoryAction).text}
                {message.memoryAction.type === "saved" &&
                  message.memoryAction.memory?.content && (
                    <span className="memory-badge-detail">
                      {message.memoryAction.memory.content}
                    </span>
                  )}
              </div>
            )}

            {message.image && (
              <figure className="image-result">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
                <img src={message.image.dataUrl} alt={message.content} />
                <figcaption>
                  <a
                    className="auth-btn"
                    href={message.image.dataUrl}
                    download={`bdm-image-${message.image.createdAt.replace(/[:.]/g, "-")}.png`}
                  >
                    Download
                  </a>
                  <span className="hint">
                    {" "}
                    {message.image.model} · {message.image.size} · {message.image.quality}
                  </span>
                </figcaption>
              </figure>
            )}

            {message.sources && message.sources.length > 0 && (
              <div className="sources">
                <div className="sources-title">Sources</div>
                <ol>
                  {message.sources.map((source) => (
                    <li key={`${source.index}-${source.url}`} value={source.index}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer nofollow">
                        {source.title}
                      </a>
                      <span className="source-meta">
                        {source.domain}
                        {source.publishedDate ? ` · ${source.publishedDate}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {message.warning && <p className="notice warn">{message.warning}</p>}

            {message.memoriesUsed && message.memoriesUsed.length > 0 && (
              <details className="used-memories">
                <summary>
                  Used {message.memoriesUsed.length}{" "}
                  {message.memoriesUsed.length === 1 ? "memory" : "memories"}
                </summary>
                <ul>
                  {message.memoriesUsed.map((memory) => (
                    <li key={memory.id}>
                      <span className="badge">{memory.kind}</span> {memory.content}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        ))}
        {busy && (
          <article className="message assistant">
            <div className="label">BDM</div>
            <div className="message-text">
              {researchMode ? "Researching the web…" : "Thinking…"}
            </div>
          </article>
        )}
      </section>

      <form className="composer" onSubmit={submit}>
        <div className="composer-tools">
          <button
            type="button"
            className={`tool ${researchMode ? "active" : ""}`}
            aria-pressed={researchMode}
            onClick={() => setResearchMode((value) => !value)}
            title={
              researchReady
                ? "Answer with web research and citations"
                : "Web research is not configured on the server"
            }
          >
            {researchMode ? "Research on" : "Research"}
          </button>
          <button
            type="button"
            className="tool"
            onClick={() => setShowImage(true)}
            aria-haspopup="dialog"
          >
            Image
          </button>
          <button
            type="button"
            className="tool"
            onClick={() => setShowVoice(true)}
            aria-haspopup="dialog"
          >
            Voice
          </button>
          <button
            type="button"
            className="tool"
            onClick={() => setShowEmail(true)}
            aria-haspopup="dialog"
            disabled={!user}
            title={user ? "Compose and send an email" : "Sign in to send email"}
          >
            Email
          </button>
          {researchMode && !researchReady && (
            <span className="tool-hint">
              Research is not configured, so requests will report that instead of guessing.
            </span>
          )}
          {researchMode && researchReady && (
            <span className="tool-hint">Only your question is sent to the search provider.</span>
          )}
        </div>
        <div className="composer-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              researchMode ? "Ask a question BDM should research…" : "Ask BDM anything…"
            }
            aria-label="Message BDM"
            rows={2}
          />
          <button type="submit" disabled={busy || !input.trim()}>
            Send
          </button>
        </div>
      </form>

      <MemoryPanel
        open={showMemory}
        onClose={() => setShowMemory(false)}
        onHistoryCleared={clearHistory}
      />

      {showImage && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowImage(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Generate an image">
            <ImagePanel
              configured={imageReady}
              onGenerated={(image, prompt) => {
                setMessages((current) => [
                  ...current,
                  {
                    role: "assistant",
                    content: `Generated image: ${prompt}`,
                    kind: "image",
                    image
                  }
                ]);
              }}
              onClose={() => setShowImage(false)}
            />
          </div>
        </div>
      )}

      {showVoice && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Voice note">
            <VoiceRecorder
              configured={voiceReady}
              maxSeconds={status?.voice.maxDurationSeconds ?? 300}
              onUseTranscript={useTranscript}
              onClose={() => setShowVoice(false)}
            />
          </div>
        </div>
      )}

      {showEmail && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowEmail(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Send an email">
            <EmailPanel
              configured={status?.email?.configured ?? false}
              onClose={() => setShowEmail(false)}
            />
          </div>
        </div>
      )}
    </main>
  );
}

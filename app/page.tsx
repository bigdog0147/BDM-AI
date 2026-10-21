"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar, { type WorkspaceView } from "./components/Sidebar";
import ResearchView from "./components/ResearchView";
import MemoryPanel from "./components/MemoryPanel";
import Modal from "./components/Modal";
import ImagePanel, { type GeneratedImage } from "./components/ImagePanel";
import EmailPanel from "./components/EmailPanel";
import VoiceRecorder from "./components/VoiceRecorder";
import { Icon, GoogleIcon } from "./components/Icons";
import Markdown from "./components/Markdown";
import Welcome from "./components/Welcome";
import type {
  AuthUser,
  CapabilityStatus,
  ConversationSummary,
  MemoryUsed,
  MessageMemoryAction,
  Source
} from "./components/types";
import { displayNameFromEmail, greetingFor } from "../lib/workspace";


type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  kind?: "chat" | "research" | "image" | "error";
  sources?: Source[];
  image?: GeneratedImage;
  memoryAction?: MessageMemoryAction;
  memoriesUsed?: MemoryUsed[];
  warning?: string;
  /** Set on a failed turn so it can be run again without duplicating it. */
  retryText?: string;
};

/**
 * The workspace.
 *
 * One focused conversation column, a compact navigation sidebar, and a
 * composer that carries the three ways to talk to BDM: type, speak, or
 * research the live web. Provider diagnostics live on the Settings page, not
 * here.
 */
export default function Home() {
  const router = useRouter();

  const [user, setUser] = useState<AuthUser>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [status, setStatus] = useState<CapabilityStatus | null>(null);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [researchMode, setResearchMode] = useState(false);
  const [view, setView] = useState<WorkspaceView>("chat");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // ---- session ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data: { user: AuthUser }) => {
        if (cancelled) return;
        setUser(data.user);
        setAuthChecked(true);
      })
      .catch(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Capability flags only. The full provider report lives on /settings.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((response) => response.json())
      .then((data: CapabilityStatus) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        // Capability flags are informational; the app still works without them.
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/conversations", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as {
        conversations?: ConversationSummary[];
      };
      setConversations(data.conversations ?? []);
    } catch {
      // History is a convenience: a failure must not break the chat.
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadConversations();
  }, [user, loadConversations]);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/conversations/${id}/messages`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        messages?: {
          role: string;
          content?: { text?: string; sources?: Source[] };
        }[];
      };
      const history: ChatMessage[] = (data.messages ?? [])
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content?.text ?? "",
          kind: message.content?.sources?.length ? "research" : "chat",
          sources: Array.isArray(message.content?.sources)
            ? message.content.sources
            : undefined
        }));
      setConversationId(id);
      setMessages(history);
      setView("chat");
    } catch {
      // Keep the current conversation if it cannot be loaded.
    }
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setInput("");
    setResearchMode(false);
    setView("chat");
    setMobileOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    setUser(null);
    setConversationId(null);
    setMessages([]);
    setShowVoice(false);
    setShowImage(false);
    setShowEmail(false);
    setShowMemory(false);
    router.refresh();
  }

  // ---- sending ---------------------------------------------------------
  async function submit(
    event?: FormEvent,
    options?: { text?: string; appendUser?: boolean }
  ) {
    event?.preventDefault();
    const text = (options?.text ?? input).trim();
    // `sendingRef` is the duplicate-submission guard: a second click, an
    // Enter key, or a retry can never create a second user message.
    if (!text || busy || sendingRef.current) return;

    sendingRef.current = true;
    if (options?.appendUser !== false) {
      setMessages((current) => [...current, { role: "user", content: text }]);
      setInput("");
    }
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (researchMode) {
        const response = await fetch("/api/research", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: text, conversationId }),
          signal: controller.signal
        });
        const data = (await response.json()) as {
          answer?: string;
          sources?: Source[];
          missingCitations?: boolean;
          conversationId?: string | null;
          error?: string;
          reason?: string;
        };

        if (typeof data.conversationId === "string" && data.conversationId) {
          setConversationId(data.conversationId);
        }

        if (!response.ok || typeof data.answer !== "string") {
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              content:
                data.error ??
                "Research could not complete. Nothing was added to the conversation.",
              kind: "error",
              sources: data.sources,
              retryText: text
            }
          ]);
          return;
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
          body: JSON.stringify({ message: text, conversationId }),
          signal: controller.signal
        });
        const data = (await response.json()) as {
          text?: string;
          conversationId?: string | null;
          memoryAction?: MessageMemoryAction;
          memoriesUsed?: MemoryUsed[];
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

      void loadConversations();
    } catch (error) {
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || /abort/i.test(error.message));

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: aborted
            ? "Stopped. The request was cancelled in your browser, so the server may still have finished it."
            : error instanceof Error
              ? `System error: ${error.message}`
              : "System error.",
          kind: "error",
          retryText: text
        }
      ]);
    } finally {
      setBusy(false);
      sendingRef.current = false;
      abortRef.current = null;
    }
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  function retry(message: ChatMessage) {
    const text = message.retryText;
    if (!text || busy) return;
    // Drop the failed turn first so the retry cannot duplicate it.
    setMessages((current) => current.slice(0, current.length - 1));
    void submit(undefined, { text, appendUser: false });
  }

  function useTranscript(text: string) {
    // The transcript is reviewed in the composer; it is never auto-sent.
    setView("chat");
    setInput((current) => (current ? `${current} ${text}` : text));
    setShowVoice(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function focusResearch() {
    setView("chat");
    setResearchMode(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // Deep link for the installed app: `/?view=research` opens the workspace
  // with Research already armed. The query is read in an effect rather than
  // through `useSearchParams`, so the page can stay statically prerendered.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    if (requested === "research") {
      setResearchMode(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, []);

  // Keep the newest turn in view without stealing focus.
  useEffect(() => {
    if (!messages.length) return;
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages, busy]);

  // ---- derived ---------------------------------------------------------
  const displayName = useMemo(
    () => displayNameFromEmail(user?.email ?? null),
    [user?.email]
  );
  const signedIn = Boolean(user);
  const accountInitial = (user?.email?.[0] ?? "B").toUpperCase();
  const emptyChat = messages.length === 0;
  const voiceReady = status?.voice.configured ?? false;
  const imageReady = status?.images.configured ?? false;
  const researchReady = status?.search.configured ?? false;
  const emailReady = status?.email?.configured ?? false;

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) ?? null,
    [conversations, conversationId]
  );

  const topbarTitle =
    view === "research"
      ? "Research"
      : activeConversation?.title || (emptyChat ? "New chat" : "Conversation");
  const topbarSub =
    view === "research"
      ? "Ask the live web and get an answer with sources."
      : emptyChat
        ? "Ask anything, speak a note, or research the web."
        : "Your conversation is saved to your account.";

  // ---- render ----------------------------------------------------------
  return (
    <div className={`app${collapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar
        user={user}
        conversations={conversations}
        activeConversationId={conversationId}
        view={view}
        mobileOpen={mobileOpen}
        collapsed={collapsed}
        onCloseMobile={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        onNewChat={newChat}
        onSelectConversation={(id) => void loadConversation(id)}
        onSelectView={(next) => {
          if (next === "research") {
            focusResearch();
          } else {
            setView("chat");
          }
          setMobileOpen(false);
        }}
        onOpenVoice={() => {
          setShowVoice(true);
          setMobileOpen(false);
        }}
        onOpenSaved={() => {
          setShowMemory(true);
          setMobileOpen(false);
        }}
        onOpenSettings={() => {
          router.push("/settings");
        }}
        onOpenHelp={() => {
          setShowHelp(true);
          setMobileOpen(false);
        }}
        onSignOut={() => void signOut()}
      />

      <a className="skip-link" href="#conversation">
        Skip to the conversation
      </a>

      <main className="workspace">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn only-mobile"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Icon name="menu" size={19} />
          </button>

          <div className="topbar-title">
            <span className="topbar-name">{topbarTitle}</span>
            <span className="topbar-sub">{topbarSub}</span>
          </div>

          <div className="topbar-actions">
            <Link
              href="/settings"
              className="icon-btn"
              title="Settings and diagnostics"
              aria-label="Settings and diagnostics"
            >
              <Icon name="settings" size={18} />
            </Link>

            {!signedIn && authChecked ? (
              <Link className="btn ghost" href="/auth">
                <GoogleIcon size={15} />
                Sign in
              </Link>
            ) : null}
          </div>
        </header>

        {view === "research" ? (
          <div className="chat-scroll" id="conversation">
            <ResearchView
              configured={researchReady}
              signedIn={signedIn}
              conversationId={conversationId}
              onConversationChange={setConversationId}
              onResearchComplete={() => {
                void loadConversations();
              }}
            />
          </div>
        ) : (
          <div className="chat-scroll" id="conversation" ref={feedRef}>
            <div className="chat-inner">
              {emptyChat ? (
                <Welcome
                  greeting={greetingFor()}
                  name={displayName}
                  researchReady={researchReady}
                  onChat={(seed) => {
                    setResearchMode(false);
                    setInput(seed);
                    requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                  onResearch={() => focusResearch()}
                />
              ) : (
                messages.map((message, index) => (
                  <article
                    key={index}
                    className={`msg ${message.role === "user" ? "msg-user" : "msg-assistant"}${
                      message.kind === "error" ? " msg-error" : ""
                    }`}
                  >
                    <div className="msg-avatar" aria-hidden="true">
                      <span className="avatar avatar-sm">
                        {message.role === "assistant" ? "B" : accountInitial}
                      </span>
                    </div>
                    <div className="msg-body">
                      <div className="msg-head">
                        <span className="msg-author">
                          {message.role === "assistant" ? "BDM" : "You"}
                        </span>
                        {message.kind === "research" ? (
                          <span className="label-tag">research</span>
                        ) : null}
                        {message.kind === "image" ? (
                          <span className="label-tag">image</span>
                        ) : null}
                      </div>

                      <div className="msg-content">
                        {message.kind === "error" ? (
                          <p className="msg-error-text">{message.content}</p>
                        ) : (
                          <Markdown
                            content={message.content}
                            sources={message.sources}
                          />
                        )}
                      </div>

                      {message.retryText ? (
                        <div className="msg-actions">
                          <button
                            type="button"
                            className="msg-retry"
                            onClick={() => retry(message)}
                            disabled={busy}
                          >
                            <Icon name="retry" size={14} />
                            Try again
                          </button>
                        </div>
                      ) : null}

                      {message.memoryAction ? (
                        <div
                          className={`memory-badge ${
                            memoryBadge(message.memoryAction).tone
                          }`}
                          role="status"
                        >
                          {memoryBadge(message.memoryAction).text}
                          {message.memoryAction.type === "saved" &&
                          message.memoryAction.memory?.content ? (
                            <span className="memory-badge-detail">
                              {message.memoryAction.memory.content}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {message.image ? (
                        <figure className="image-result">
                          {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
                          <img
                            src={message.image.dataUrl}
                            alt={message.content}
                          />
                          <figcaption>
                            <a
                              className="btn ghost"
                              href={message.image.dataUrl}
                              download={`bdm-image-${message.image.createdAt.replace(
                                /[:.]/g,
                                "-"
                              )}.png`}
                            >
                              Download
                            </a>
                            <span className="hint">
                              {message.image.model} · {message.image.size} ·{" "}
                              {message.image.quality}
                            </span>
                          </figcaption>
                        </figure>
                      ) : null}

                      {message.sources && message.sources.length > 0
                        ? messageSources(message.sources)
                        : null}

                      {message.warning ? (
                        <p className="notice warn">{message.warning}</p>
                      ) : null}

                      {message.memoriesUsed && message.memoriesUsed.length > 0 ? (
                        <details className="used-memories">
                          <summary>
                            Used {message.memoriesUsed.length}{" "}
                            {message.memoriesUsed.length === 1
                              ? "memory"
                              : "memories"}
                          </summary>
                          <ul>
                            {message.memoriesUsed.map((memory) => (
                              <li key={memory.id}>
                                <span className="badge">{memory.kind}</span>{" "}
                                {memory.content}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  </article>
                ))
              )}

              {busy ? (
                <article className="msg msg-assistant">
                  <div className="msg-avatar" aria-hidden="true">
                    <span className="avatar avatar-sm">B</span>
                  </div>
                  <div className="msg-body">
                    <div className="msg-head">
                      <span className="msg-author">BDM</span>
                      <span className="label-tag">
                        {researchMode ? "searching" : "thinking"}
                      </span>
                    </div>
                    <p className="typing" aria-live="polite">
                      <span className="typing-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                      {researchMode
                        ? "Searching the web and reading the results…"
                        : "Thinking…"}
                    </p>
                  </div>
                </article>
              ) : null}
            </div>
          </div>
        )}

        {view === "chat" ? (
          <div className="composer">
            <form className="composer-inner" onSubmit={submit}>
              <div className="composer-tools">
                <button
                  type="button"
                  className={`tool${researchMode ? " active" : ""}`}
                  onClick={() => setResearchMode((value) => !value)}
                  aria-pressed={researchMode}
                  title="Search the live web and answer with citations"
                >
                  <Icon name="globe" size={15} />
                  Research
                </button>
                <button
                  type="button"
                  className="tool"
                  onClick={() => setShowVoice(true)}
                  disabled={!signedIn}
                  title={
                    signedIn
                      ? "Record a voice note"
                      : "Sign in to use voice notes"
                  }
                >
                  <Icon name="mic" size={15} />
                  Voice note
                </button>
                <button
                  type="button"
                  className="tool"
                  onClick={() => setShowImage(true)}
                  disabled={!imageReady}
                  title={
                    imageReady
                      ? "Generate an image"
                      : "Image generation is not configured"
                  }
                >
                  <Icon name="image" size={15} />
                  Image
                </button>
                <button
                  type="button"
                  className="tool"
                  onClick={() => setShowEmail(true)}
                  disabled={!signedIn || !emailReady}
                  title={
                    emailReady && signedIn
                      ? "Draft an email"
                      : "Email sending is not available"
                  }
                >
                  <Icon name="mail" size={15} />
                  Email
                </button>
                <span className="tool-hint">
                  {busy
                    ? "Stop cancels this request"
                    : researchMode && !researchReady
                      ? "Research needs a search provider key"
                      : "Enter sends · Shift+Enter for a new line"}
                </span>
              </div>

              <div className="composer-box">
                <textarea
                  id="composer-input"
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={
                    researchMode
                      ? "Ask a research question…"
                      : "Message BDM…"
                  }
                  aria-label={researchMode ? "Research question" : "Message BDM"}
                  rows={1}
                />
                {busy ? (
                  <button
                    type="button"
                    className="send-btn send-stop"
                    onClick={stopGenerating}
                    aria-label="Stop generating"
                    title="Stop generating"
                  >
                    <Icon name="stop" size={17} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-btn"
                    disabled={!input.trim()}
                    aria-label="Send message"
                    title="Send message"
                  >
                    <Icon name="send" size={17} />
                  </button>
                )}
              </div>

              <p className="composer-hint">
                Private by default. Voice notes are transcribed and discarded,
                and research shows the sources behind every claim.
              </p>
            </form>
          </div>
        ) : null}
      </main>




      <MemoryPanel
        open={showMemory}
        onClose={() => setShowMemory(false)}
        onHistoryCleared={newChat}
      />

      <Modal open={showImage} onClose={() => setShowImage(false)}>
        <ImagePanel
          configured={imageReady}
          onGenerated={(image: GeneratedImage, prompt: string) => {
            setView("chat");
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
      </Modal>

      <Modal
        open={showVoice}
        onClose={() => setShowVoice(false)}
        title="Voice note"
      >
        <VoiceRecorder
          configured={voiceReady}
          signedIn={signedIn}
          maxSeconds={status?.voice.maxDurationSeconds ?? 300}
          onUseTranscript={useTranscript}
          onClose={() => setShowVoice(false)}
        />
      </Modal>

      <Modal
        open={showEmail}
        onClose={() => setShowEmail(false)}
        title="Send an email"
      >
        <EmailPanel configured={emailReady} onClose={() => setShowEmail(false)} />
      </Modal>

      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Help">
        <div className="panel">
          <p className="hint">
            BDM keeps your data in your own Supabase account. Provider keys
            stay on the server, recordings are never stored, and research sends
            only the question you type.
          </p>
          <div className="panel-actions">
            <Link className="btn ghost" href="/settings">
              <Icon name="settings" size={15} />
              Account and provider status
            </Link>
            <Link className="btn ghost" href="/brand">
              <Icon name="sparkle" size={15} />
              Brand assets
            </Link>
            <a className="btn ghost" href="/api/health" target="_blank">
              <Icon name="external" size={15} />
              Health check
            </a>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function memoryBadge(action: MessageMemoryAction): { text: string; tone: string } {
  switch (action.type) {
    case "saved":
      return { text: `Saved to memory (${action.memory?.kind ?? "fact"})`, tone: "ok" };
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

function messageSources(sources: Source[]) {
  return (
    <div className="sources">
      <div className="sources-title">Sources</div>
      <ol>
        {sources.map((source) => (
          <li key={`${source.index}-${source.url}`}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={source.snippet || source.title}
            >
              {source.title}
              <span className="source-meta">
                {source.domain}
                {source.publishedDate ? ` · ${source.publishedDate}` : ""}
              </span>
            </a>
            {source.snippet ? (
              <p className="source-snippet">{source.snippet}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

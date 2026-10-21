"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import Markdown, { type MarkdownSource } from "./Markdown";

export type ResearchSource = MarkdownSource & {
  publishedDate?: string | null;
  snippet?: string;
};

export type ResearchResult = {
  question: string;
  answer: string;
  sources: ResearchSource[];
  citations: number[];
  missingCitations?: boolean;
  uncertain?: boolean;
  conversationId?: string | null;
  provider?: { search?: string | null; ai?: string | null };
  model?: string | null;
  tookMs?: number;
};

type Phase = "idle" | "searching" | "done" | "error";

const STATUS_TEXT: Record<string, string> = {
  "429": "The daily research allowance for this account is used up. Try again later.",
  "503": "Web research is not configured on the server.",
  "504": "The search provider took too long to answer.",
  "502": "The search provider could not be reached."
};

/**
 * First-class research workflow.
 *
 * It calls the real `/api/research` endpoint: a live search, a real
 * synthesis, and the real sources that came back. Nothing here invents a
 * result - a failure is shown as a failure.
 */
export default function ResearchPanel({
  open,
  configured,
  initialQuery,
  conversationId,
  onClose,
  onAddToConversation
}: {
  open: boolean;
  configured: boolean;
  initialQuery?: string;
  conversationId?: string | null;
  onClose: () => void;
  onAddToConversation: (result: ResearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Contacting the search provider…");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (initialQuery) setTimeout(() => setQuery(initialQuery), 0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open, initialQuery]);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text || phase === "searching") return;

    setPhase("searching");
    setError(null);
    setResult(null);
    setStatus("Searching the web…");

    const progress = window.setTimeout(
      () => setStatus("Reading the results and writing the answer…"),
      1200
    );

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: text, conversationId: conversationId ?? null })
      });
      const data = (await response.json()) as {
        answer?: string;
        sources?: ResearchSource[];
        citations?: number[];
        missingCitations?: boolean;
        uncertain?: boolean;
        conversationId?: string | null;
        provider?: { search?: string | null; ai?: string | null };
        model?: string | null;
        tookMs?: number;
        error?: string;
        reason?: string;
      };

      if (!response.ok) {
        const fallback = STATUS_TEXT[String(response.status)];
        throw new Error(
          fallback ?? data.error ?? "The research request could not be completed."
        );
      }

      if (typeof data.answer !== "string") {
        throw new Error("The research request did not return an answer.");
      }

      setResult({
        question: text,
        answer: data.answer,
        sources: Array.isArray(data.sources) ? data.sources : [],
        citations: Array.isArray(data.citations) ? data.citations : [],
        missingCitations: data.missingCitations,
        uncertain: data.uncertain,
        conversationId: data.conversationId ?? null,
        provider: data.provider,
        model: data.model ?? null,
        tookMs: data.tookMs
      });
      setPhase("done");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The research request could not be completed."
      );
      setPhase("error");
    } finally {
      window.clearTimeout(progress);
    }
  }

  if (!open) return null;

  const busy = phase === "searching";

  return (
    <section className="panel research" aria-label="Web research">
      <div className="panel-head">
        <div>
          <strong className="panel-title">Web research</strong>
          <p className="hint panel-hint">
            BDM searches the web, then answers using only the sources it found.
            Only your question is sent to the search provider.
          </p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {!configured && (
        <p className="notice warn">
          Web research is not configured on this server yet, so a search would
          fail. Ordinary chat still works. Ask the owner to add a search
          provider key (for example <code>TAVILY_API_KEY</code>).
        </p>
      )}

      <form className="research-form" onSubmit={run}>
        <label className="field-label" htmlFor="research-query">
          Research question
        </label>
        <input
          id="research-query"
          ref={inputRef}
          className="field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="What should BDM look up for you?"
          maxLength={400}
          disabled={busy}
        />
        <button
          type="submit"
          className="btn primary"
          disabled={busy || !query.trim()}
        >
          <Icon name="globe" size={16} />
          {busy ? "Researching…" : "Run research"}
        </button>
      </form>

      {busy ? (
        <p className="research-status" role="status">
          <span className="spinner" aria-hidden="true" />
          {status}
        </p>
      ) : null}

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      {phase === "done" && result ? (
        <div className="research-result">
          {result.sources.length === 0 ? (
            <p className="notice warn">
              No sources were found for that question, so there is nothing
              reliable to summarise.
            </p>
          ) : (
            <p className="hint">
              {result.sources.length} source
              {result.sources.length === 1 ? "" : "s"} from{" "}
              <strong>{result.provider?.search ?? "the search provider"}</strong>
              {result.model ? ` · answer by ${result.model}` : ""}
              {typeof result.tookMs === "number"
                ? ` · ${Math.round(result.tookMs / 100) / 10}s`
                : ""}
            </p>
          )}

          <div className="research-answer">
            <Markdown content={result.answer} sources={result.sources} />
          </div>

          {result.missingCitations ? (
            <p className="notice warn">
              The answer did not cite its sources. Treat the claims as
              unverified.
            </p>
          ) : null}

          {result.sources.length > 0 ? (
            <div className="sources">
              <div className="sources-title">Sources</div>
              <ol>
                {result.sources.map((source) => (
                  <li key={`${source.index}-${source.url}`}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {source.title}
                    </a>
                    <span className="source-meta">
                      {source.domain}
                      {source.publishedDate ? ` · ${source.publishedDate}` : ""}
                    </span>
                    {source.snippet ? (
                      <p className="source-snippet">{source.snippet}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="panel-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => onAddToConversation(result)}
            >
              Add to conversation
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setResult(null);
                setPhase("idle");
                inputRef.current?.focus();
              }}
            >
              Ask another question
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

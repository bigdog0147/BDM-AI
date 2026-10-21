"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icons";
import Markdown from "./Markdown";
import type { Source } from "./types";

type ResearchResult = {
  query: string;
  answer: string;
  sources: Source[];
  citations: number[];
  missingCitations: boolean;
  conversationId: string | null;
};

const EXAMPLES = [
  "What changed in the EU AI Act in 2026?",
  "Compare the leading open-weight coding models",
  "What are the current best practices for Postgres row-level security?"
];

/**
 * The research workspace.
 *
 * The question is the only thing that leaves BDM: the search provider never
 * receives the conversation, the memories, or any account data. The answer
 * always arrives with the sources it was built from, or with an honest
 * statement that the search did not find enough.
 */
export default function ResearchView({
  configured,
  signedIn,
  conversationId,
  onConversationChange,
  onResearchComplete
}: {
  configured: boolean;
  signedIn: boolean;
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  onResearchComplete: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [partialSources, setPartialSources] = useState<Source[] | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  async function runResearch(rawQuery: string) {
    const text = rawQuery.replace(/\s+/g, " ").trim();
    if (!text || busy) return;
    if (text.length < 3) {
      setError("Ask a slightly more specific question.");
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setBusy(true);
    setError(null);
    setResult(null);
    setPartialSources(null);

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: text, conversationId }),
        signal: controller.signal
      });
      const data = (await response.json()) as {
        answer?: string;
        sources?: Source[];
        citations?: number[];
        missingCitations?: boolean;
        conversationId?: string | null;
        error?: string;
      };

      if (typeof data.conversationId === "string" && data.conversationId) {
        onConversationChange(data.conversationId);
      }

      if (!response.ok || typeof data.answer !== "string") {
        setPartialSources(Array.isArray(data.sources) ? data.sources : null);
        setError(data.error || "Research failed. The server did not return an answer.");
        return;
      }

      setResult({
        query: text,
        answer: data.answer,
        sources: Array.isArray(data.sources) ? data.sources : [],
        citations: Array.isArray(data.citations) ? data.citations : [],
        missingCitations: Boolean(data.missingCitations),
        conversationId: data.conversationId ?? null
      });
      onResearchComplete();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(null);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Research failed before a response arrived."
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void runResearch(query);
  }

  function cancel() {
    controllerRef.current?.abort();
    setBusy(false);
  }

  return (
    <div className="research-view">
      <div className="research-head">
        <h1 className="research-title">Research</h1>
        <p className="research-sub">
          BDM searches the live web, reads the results, and writes an answer
          with citations you can open. If it cannot find evidence, it says so.
        </p>
      </div>

      <form className="research-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="research-question">
          Research question
        </label>
        <textarea
          id="research-question"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="What should BDM investigate?"
          aria-label="Research question"
          rows={2}
          maxLength={400}
          disabled={busy || !configured}
        />
        <div className="research-foot">
          <span className="input-hint">
            {query.length}/400 · Only your question is sent to the search provider
          </span>
          {busy ? (
            <button type="button" className="btn ghost" onClick={cancel}>
              <Icon name="stop" size={15} />
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              className="btn primary"
              disabled={!configured || !query.trim()}
            >
              <Icon name="globe" size={16} />
              Research
            </button>
          )}
        </div>
      </form>

      {!configured && (
        <p className="notice error">
          Web research is not configured on this server. Add a Tavily, Brave, or
          SearXNG provider key in <Link href="/settings">Settings</Link>.
        </p>
      )}
      {!signedIn && configured && (
        <p className="notice">
          You can research without signing in, but only signed-in research is
          saved to your history.
        </p>
      )}

      {!result && !busy && !error && (
        <div className="example-grid" aria-label="Example research questions">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="example-chip"
              onClick={() => {
                setQuery(example);
                inputRef.current?.focus();
              }}
            >
              <span>{example}</span>
              <Icon name="external" size={14} />
            </button>
          ))}
        </div>
      )}

      {busy && (
        <p className="research-status" role="status">
          <span className="spinner" aria-hidden="true" />
          Searching the web, reading the strongest results, then checking the
          citations…
        </p>
      )}

      {error && (
        <div className="notice error" role="alert">
          <p className="msg-error-text">{error}</p>
          {partialSources && partialSources.length > 0 ? (
            <p className="hint">
              The search provider did return {partialSources.length} source
              {partialSources.length === 1 ? "" : "s"}; they are listed below
              without a synthesized answer.
            </p>
          ) : null}
          <div className="panel-actions" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void runResearch(query)}
              disabled={!query.trim()}
            >
              <Icon name="retry" size={15} />
              Try again
            </button>
          </div>
        </div>
      )}

      {partialSources && partialSources.length > 0 && !result && (
        <SourceList sources={partialSources} />
      )}

      {result && (
        <section className="research-result" aria-live="polite">
          <h2 className="research-question">{result.query}</h2>

          {result.missingCitations && (
            <p className="notice warn">
              The answer did not cite its sources. Treat the claims as
              unverified and check the sources directly.
            </p>
          )}

          <div className="research-answer">
            <Markdown content={result.answer} sources={result.sources} />
          </div>

          <SourceList sources={result.sources} />

          <div className="panel-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setResult(null);
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <Icon name="plus" size={15} />
              New search
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function SourceList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) {
    return (
      <p className="hint">
        No sources were returned for this question.
      </p>
    );
  }

  return (
    <section className="source-section" aria-label="Sources">
      <div className="sources-title">
        Sources · {sources.length} found
      </div>
      <div className="source-grid">
        {sources.map((source) => (
          <a
            key={`${source.index}-${source.url}`}
            className="source-card"
            href={source.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            <span className="source-top">
              <span className="source-index">{source.index}</span>
              <span className="source-title">{source.title}</span>
            </span>
            <span className="source-domain">
              {source.domain}
              {source.publishedDate ? ` · ${source.publishedDate}` : ""}
            </span>
            {source.snippet ? (
              <p className="source-snippet">{source.snippet}</p>
            ) : null}
          </a>
        ))}
      </div>
    </section>
  );
}

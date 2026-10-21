"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Memory = {
  id: string;
  kind: string;
  content: string;
  importance: number;
  pinned: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

const KINDS = [
  "fact",
  "preference",
  "goal",
  "project",
  "person",
  "instruction",
  "summary"
];

export default function MemoryPanel({
  open,
  onClose,
  onHistoryCleared
}: {
  open: boolean;
  onClose: () => void;
  onHistoryCleared?: () => void;
}) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState("fact");
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (search: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("q", search.trim());
        const response = await fetch(`/api/memories?${params.toString()}`);
        if (response.status === 401) {
          setSignedOut(true);
          setMemories([]);
          return;
        }
        const data = (await response.json()) as { memories?: Memory[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load memories");
        setSignedOut(false);
        setMemories(data.memories ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load memories");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      void load(query);
    }, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, query, load]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function remove(id: string) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/memories/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete that memory");
      setMemories((current) => current.filter((memory) => memory.id !== id));
      if (editingId === id) setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that memory");
    } finally {
      setSaving(false);
    }
  }

  async function save(id: string) {
    const content = draft.trim();
    if (!content) {
      setError("Memory cannot be empty");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/memories/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, kind: draftKind })
      });
      const data = (await response.json()) as { memory?: Memory; error?: string };
      if (!response.ok || !data.memory) {
        throw new Error(data.error || "Could not update that memory");
      }
      const updated = data.memory;
      setMemories((current) =>
        current.map((memory) => (memory.id === id ? updated : memory))
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that memory");
    } finally {
      setSaving(false);
    }
  }

  async function togglePinned(memory: Memory) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/memories/${memory.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: !memory.pinned })
      });
      const data = (await response.json()) as { memory?: Memory; error?: string };
      if (!response.ok || !data.memory) {
        throw new Error(data.error || "Could not update that memory");
      }
      const updated = data.memory;
      setMemories((current) =>
        current.map((entry) => (entry.id === memory.id ? updated : entry))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that memory");
    } finally {
      setSaving(false);
    }
  }

  async function clearAll() {
    if (
      !window.confirm(
        "Delete every saved memory? This cannot be undone. Conversation history is not affected."
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/memories", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not clear memories");
      setMemories([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear memories");
    } finally {
      setSaving(false);
    }
  }

  async function clearHistory() {
    if (
      !window.confirm(
        "Delete all conversation history? Saved memories are kept. This cannot be undone."
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/conversations", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not clear conversation history");
      onHistoryCleared?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not clear conversation history"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Saved memories"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h2>Memory</h2>
            <p className="hint">
              Only what you explicitly ask BDM to remember. Secrets are refused.
            </p>
          </div>
          <button type="button" className="auth-btn" onClick={onClose} aria-label="Close memory panel">
            Close
          </button>
        </header>

        <input
          ref={searchRef}
          className="field"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search memories…"
          aria-label="Search memories"
        />

        {signedOut && (
          <p className="notice">
            <a href="/auth">Sign in</a> to view and manage saved memories.
          </p>
        )}
        {error && <p className="notice error">{error}</p>}
        {loading && <p className="hint">Loading…</p>}

        {!signedOut && !loading && memories.length === 0 && !error && (
          <p className="hint">
            {query
              ? "No memories match that search."
              : "No memories yet. Say “remember this: …” in chat to save one."}
          </p>
        )}

        <ul className="memory-list">
          {memories.map((memory) => (
            <li key={memory.id} className="memory-item">
              <div className="memory-meta">
                <span className="badge">{memory.kind}</span>
                {memory.pinned && <span className="badge pin">pinned</span>}
                {typeof memory.metadata?.project === "string" && (
                  <span className="badge">{memory.metadata.project}</span>
                )}
              </div>

              {editingId === memory.id ? (
                <div className="memory-edit">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={3}
                    aria-label="Edit memory content"
                  />
                  <div className="memory-actions">
                    <select
                      value={draftKind}
                      onChange={(event) => setDraftKind(event.target.value)}
                      aria-label="Memory kind"
                    >
                      {KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => void save(memory.id)} disabled={saving}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setEditingId(null)}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="memory-content">{memory.content}</p>
                  <div className="memory-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setEditingId(memory.id);
                        setDraft(memory.content);
                        setDraftKind(memory.kind);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void togglePinned(memory)}
                      disabled={saving}
                      aria-pressed={memory.pinned}
                    >
                      {memory.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      onClick={() => void remove(memory.id)}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>

        {!signedOut && (
          <footer className="drawer-foot">
            {memories.length > 0 && (
              <button
                type="button"
                className="ghost danger"
                onClick={() => void clearAll()}
                disabled={saving}
              >
                Clear all memories
              </button>
            )}
            <button
              type="button"
              className="ghost"
              onClick={() => void clearHistory()}
              disabled={saving}
            >
              Clear conversation history
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

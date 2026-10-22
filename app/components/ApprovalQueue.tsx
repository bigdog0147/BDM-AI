"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icons";

type Approval = {
  id: string;
  task_id: string;
  step_index: number;
  tool_key: string;
  args: Record<string, unknown>;
  expected_outcome: string | null;
  expires_at: string;
  task: {
    id: string;
    title: string;
    status: string;
  };
};

export default function ApprovalQueue({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks/approvals");
      if (response.status === 401) {
        setApprovals([]);
        return;
      }
      if (!response.ok) throw new Error("Failed to load approvals");
      const data = await response.json();
      setApprovals(data.approvals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      await load();
    };
    run();
    return () => {
      mounted = false;
    };
  }, [open, load]);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    if (processing.has(id)) return;
    setProcessing((prev) => new Set([...prev, id]));
    try {
      const response = await fetch(`/api/tasks/${id}/approve`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision })
      });
      if (!response.ok) throw new Error("Could not process approval");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process approval");
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const formatArgs = (args: Record<string, unknown>) => {
    try {
      return JSON.stringify(args, null, 2).slice(0, 500);
    } catch {
      return "[complex object]";
    }
  };

  const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Approval queue"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h2>Approval Queue</h2>
            <p className="hint">
              Steps requiring your approval before execution.
            </p>
          </div>
          <button type="button" className="auth-btn" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        {error && <p className="notice error">{error}</p>}
        {loading && <p className="hint">Loading…</p>}

        {!loading && approvals.length === 0 && !error && (
          <p className="hint">No pending approvals.</p>
        )}

        <ul className="approval-list">
          {approvals.map((approval) => (
            <li key={approval.id} className="approval-item">
              <div className="approval-header">
                <div className="approval-task">
                  <span className="badge">{approval.task.status}</span>
                  <strong>{approval.task.title}</strong>
                  <span className="hint">Step {approval.step_index + 1}</span>
                </div>
                {isExpired(approval.expires_at) && (
                  <span className="badge expired">Expired</span>
                )}
              </div>

              <div className="approval-details">
                <div className="detail-row">
                  <span className="detail-label">Tool</span>
                  <code className="detail-value">{approval.tool_key}</code>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Expected</span>
                  <span className="detail-value">{approval.expected_outcome || "—"}</span>
                </div>
                {Object.keys(approval.args).length > 0 && (
                  <div className="detail-row">
                    <span className="detail-label">Arguments</span>
                    <pre className="detail-args">{formatArgs(approval.args)}</pre>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-label">Expires</span>
                  <time className="detail-value" dateTime={approval.expires_at}>
                    {new Date(approval.expires_at).toLocaleString()}
                  </time>
                </div>
              </div>

              <div className="approval-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => decide(approval.id, "approved")}
                  disabled={processing.has(approval.id) || isExpired(approval.expires_at)}
                >
                  {processing.has(approval.id) ? "Approving…" : "Approve"}
                </button>
                <button
                  type="button"
                  className="btn ghost danger"
                  onClick={() => decide(approval.id, "rejected")}
                  disabled={processing.has(approval.id) || isExpired(approval.expires_at)}
                >
                  {processing.has(approval.id) ? "Rejecting…" : "Reject"}
                </button>
              </div>
            </li>
          ))}
        </ul>

        <footer className="drawer-foot">
          <button type="button" className="ghost" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </footer>
      </aside>
    </div>
  );
}
"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icons";

type TaskStepRecord = {
  id: string;
  task_id: string;
  step_index: number;
  tool_key: string;
  args: Record<string, unknown>;
  expected_outcome: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result: unknown | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  retry_count: number;
  idempotent: boolean;
};

type TaskRecoveryInfo = {
  task: {
    id: string;
    title: string;
    status: string;
    plan: Array<{
      id: string;
      description: string;
      tool: string;
      requiresApproval: boolean;
    }>;
    current_step: number;
    checkpoints: Array<{
      step: number;
      output: unknown;
      verifiedAt: string;
      verified: boolean;
    }>;
    retry_count: number;
    max_retries: number;
    error: string | null;
  };
  steps: TaskStepRecord[];
};

export default function TaskRecovery({
  open,
  onClose,
  taskId
}: {
  open: boolean;
  onClose: () => void;
  taskId: string;
}) {
  const [info, setInfo] = useState<TaskRecoveryInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"idle" | "retry" | "cancel" | "start">("idle");

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    try {
      const [taskRes, stepsRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}`),
        fetch(`/api/tasks/${taskId}/steps`)
      ]);
      if (!taskRes.ok) throw new Error("Task not found");
      const taskData = await taskRes.json();
      const stepsData = await stepsRes.json();
      setInfo({
        task: taskData.task,
        steps: stepsData.steps ?? []
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load task");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

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
  }, [open, taskId, load]);

  const executeAction = async (type: "retry" | "cancel" | "start") => {
    if (!taskId) return;
    setAction(type);
    setError(null);
    try {
      const url = `/api/tasks/${taskId}/${type}`;
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" } });
      if (!res.ok) throw new Error("Could not process action");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${type} task`);
    } finally {
      setAction("idle");
    }
  };

  if (!open) return null;

  if (!info) {
    return (
      <div className="drawer-backdrop" onClick={onClose}>
        <aside className="drawer" onClick={(e) => e.stopPropagation()}>
          <header className="drawer-head">
            <h2>Task Recovery</h2>
            <button type="button" className="auth-btn" onClick={onClose}>Close</button>
          </header>
          {loading && <p className="hint">Loading…</p>}
          {error && <p className="notice error">{error}</p>}
        </aside>
      </div>
    );
  }

  const task = info.task;
  const steps = info.steps;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return "✓";
      case "failed": return "✗";
      case "running": return "⟳";
      case "skipped": return "⊘";
      default: return "○";
    }
  };

  const canRetry = task.status === "failed" || task.status === "cancelled";
  const canStart = task.status === "queued" || task.status === "planning";
  const canCancel = task.status === "running" || task.status === "planning" || task.status === "awaiting_approval";

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h2>Task Recovery</h2>
            <p className="hint">{task.title}</p>
          </div>
          <button type="button" className="auth-btn" onClick={onClose}>Close</button>
        </header>

        {error && <p className="notice error">{error}</p>}

        <div className="recovery-summary">
          <div className="summary-row">
            <span className="summary-label">Status</span>
            <span className={`badge ${task.status}`}>{task.status}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Progress</span>
            <span className="summary-value">{task.current_step}/{task.plan.length} steps</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Retries</span>
            <span className="summary-value">{task.retry_count}/{task.max_retries}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Checkpoints</span>
            <span className="summary-value">{task.checkpoints.length}</span>
          </div>
          {task.error && (
            <div className="summary-row error">
              <span className="summary-label">Error</span>
              <span className="summary-value">{task.error}</span>
            </div>
          )}
        </div>

        <div className="recovery-steps">
          <h3>Steps</h3>
          <ol>
            {task.plan.map((planStep, index) => {
              const step = steps.find((s) => s.step_index === index);
              const status = step?.status ?? "pending";
              const isCurrent = index === task.current_step;
              return (
                <li key={planStep.id} className={`step-row ${status} ${isCurrent ? "current" : ""}`}>
                  <span className="step-icon">{getStatusIcon(status)}</span>
                  <div className="step-info">
                    <div className="step-title-row">
                      <strong>{planStep.description}</strong>
                      <span className="step-tool">{planStep.tool}</span>
                    </div>
                    <div className="step-meta">
                      {planStep.requiresApproval && <span className="approval-badge">Needs approval</span>}
                      {step && step.duration_ms && <span className="hint">{step.duration_ms}ms</span>}
                      {step && step.retry_count > 0 && <span className="hint warn">{step.retry_count} retries</span>}
                    </div>
                    {step?.error && (
                      <p className="step-error">Error: {step.error}</p>
                    )}
                    {step && step.result && status === "completed" ? (
                      <details className="step-result">
                        <summary>View result</summary>
                        <pre>{String(JSON.stringify(step.result as object, null, 2))}</pre>
                      </details>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <footer className="drawer-foot">
          <div className="recovery-actions">
            {canStart && (
              <button
                type="button"
                className="btn"
                onClick={() => executeAction("start")}
                disabled={action !== "idle"}
              >
                {action === "start" ? "Starting…" : "Start Task"}
              </button>
            )}
            {canRetry && (
              <button
                type="button"
                className="btn"
                onClick={() => executeAction("retry")}
                disabled={action !== "idle"}
              >
                {action === "retry" ? "Retrying…" : "Retry Task"}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                className="btn ghost danger"
                onClick={() => executeAction("cancel")}
                disabled={action !== "idle"}
              >
                {action === "cancel" ? "Cancelling…" : "Cancel Task"}
              </button>
            )}
          </div>
        </footer>
      </aside>
    </div>
  );
}
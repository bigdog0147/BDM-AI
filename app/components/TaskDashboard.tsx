"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TaskStep = {
  id: string;
  description: string;
  tool: string;
  args: Record<string, unknown>;
  expectedOutcome: string;
  idempotent: boolean;
  requiresApproval: boolean;
  timeoutMs: number;
};

type TaskCheckpoint = {
  step: number;
  output: unknown;
  verifiedAt: string;
  verified: boolean;
};

type Task = {
  id: string;
  project_key: string | null;
  title: string;
  description: string | null;
  status: "queued" | "planning" | "awaiting_approval" | "running" | "verifying" | "completed" | "failed" | "cancelled";
  plan: TaskStep[];
  current_step: number;
  checkpoints: TaskCheckpoint[];
  retry_count: number;
  max_retries: number;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

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
  created_at: string;
};

type Approval = {
  id: string;
  task_id: string;
  step_index: number;
  tool_key: string;
  args: Record<string, unknown>;
  expected_outcome: string | null;
  expires_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  queued: "var(--bdm-muted)",
  planning: "var(--bdm-electric)",
  awaiting_approval: "var(--bdm-gold)",
  running: "var(--bdm-electric)",
  verifying: "var(--bdm-gold)",
  completed: "var(--bdm-gold)",
  failed: "var(--bdm-error)",
  cancelled: "var(--bdm-muted)"
};

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  planning: "Planning",
  awaiting_approval: "Awaiting Approval",
  running: "Running",
  verifying: "Verifying",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled"
};

export default function TaskDashboard({
  open,
  onClose,
  projectKey
}: {
  open: boolean;
  onClose: () => void;
  projectKey?: string | null;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskSteps, setTaskSteps] = useState<TaskStepRecord[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (projectKey) params.set("project", projectKey);
      const response = await fetch(`/api/tasks?${params.toString()}`);
      if (response.status === 401) {
        setSignedOut(true);
        setTasks([]);
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load tasks");
      setSignedOut(false);
      setTasks(data.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tasks");
    } finally {
      setLoading(false);
    }
  }, [filter, projectKey]);

  const loadApprovals = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks/approvals");
      if (response.status === 401) return;
      const data = await response.json();
      if (response.ok) setApprovals(data.approvals ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      await loadTasks();
      if (!mounted) return;
      await loadApprovals();
    };
    run();
    const timer = setInterval(run, 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [open, loadTasks, loadApprovals]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  async function loadTaskDetail(task: Task) {
    setSelectedTask(task);
    setTaskSteps([]);
    try {
      const response = await fetch(`/api/tasks/${task.id}`);
      if (response.ok) {
        const data = await response.json();
        setTaskSteps(data.steps ?? []);
      }
    } catch {
      // ignore
    }
  }

  async function startTask(taskId: string) {
    try {
      const response = await fetch(`/api/tasks/${taskId}/start`, { method: "POST" });
      if (!response.ok) throw new Error("Could not start task");
      loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start task");
    }
  }

  async function cancelTask(taskId: string) {
    if (!window.confirm("Cancel this task? Progress will be saved but execution stops.")) return;
    try {
      const response = await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error("Could not cancel task");
      loadTasks();
      if (selectedTask?.id === taskId) setSelectedTask(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel task");
    }
  }

  async function retryTask(taskId: string) {
    try {
      const response = await fetch(`/api/tasks/${taskId}/retry`, { method: "POST" });
      if (!response.ok) throw new Error("Could not retry task");
      loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not retry task");
    }
  }

  async function decideApproval(approvalId: string, decision: "approved" | "rejected") {
    try {
      const response = await fetch(`/api/tasks/${approvalId}/approve`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision })
      });
      if (!response.ok) throw new Error("Could not process approval");
      loadTasks();
      loadApprovals();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process approval");
    }
  }

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer task-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Task dashboard"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h2>Tasks</h2>
            <p className="hint">Multi-step work with checkpoints, approvals, and recovery</p>
          </div>
          <button type="button" className="auth-btn" onClick={onClose} aria-label="Close task dashboard">
            Close
          </button>
        </header>

        {/* Approvals banner */}
        {approvals.length > 0 && (
          <div className="approvals-banner">
            <strong>{approvals.length} step(s) awaiting your approval</strong>
            {approvals.map((a) => (
              <div key={a.id} className="approval-item">
                <span>Task step {a.step_index + 1}: <code>{a.tool_key}</code></span>
                <div className="approval-actions">
                  <button type="button" className="ghost" onClick={() => decideApproval(a.id, "approved")}>
                    Approve
                  </button>
                  <button type="button" className="ghost danger" onClick={() => decideApproval(a.id, "rejected")}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="drawer-toolbar">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="field" aria-label="Filter by status">
            <option value="all">All</option>
            <option value="queued">Queued</option>
            <option value="planning">Planning</option>
            <option value="awaiting_approval">Awaiting Approval</option>
            <option value="running">Running</option>
            <option value="verifying">Verifying</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button type="button" className="ghost" onClick={loadTasks} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {signedOut && (
          <p className="notice"><a href="/auth">Sign in</a> to view and manage tasks.</p>
        )}
        {error && <p className="notice error">{error}</p>}
        {loading && <p className="hint">Loading…</p>}

        {!signedOut && !loading && tasks.length === 0 && !error && (
          <p className="hint">No tasks yet. Create one from chat or the API.</p>
        )}

        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className={`task-item ${selectedTask?.id === task.id ? "selected" : ""}`}>
              <div className="task-header" onClick={() => loadTaskDetail(task)}>
                <div className="task-title-row">
                  <h3>{task.title}</h3>
                  <span className="badge" style={{ backgroundColor: STATUS_COLORS[task.status] }}>
                    {STATUS_LABELS[task.status]}
                  </span>
                </div>
                {task.description && <p className="task-desc">{task.description}</p>}
                <div className="task-meta">
                  {task.project_key && <span className="badge">{task.project_key}</span>}
                  <span className="hint">{task.current_step}/{task.plan.length} steps</span>
                  {task.retry_count > 0 && (
                    <span className="badge" style={{ backgroundColor: "var(--bdm-gold)" }}>
                      Retried {task.retry_count}/{task.max_retries}
                    </span>
                  )}
                  <span className="hint">Updated {new Date(task.updated_at).toLocaleString()}</span>
                </div>
                {task.error && <p className="task-error">Error: {task.error}</p>}
              </div>

              {selectedTask?.id === task.id && (
                <div className="task-detail">
                  <div className="task-steps">
                    <h4>Steps</h4>
                    {taskSteps.length > 0 ? (
                      <ol>
                        {taskSteps.map((step) => (
                          <li key={step.id} className={`step-row ${step.status}`}>
                            <span className="step-index">{step.step_index + 1}</span>
                            <span className="step-tool">{step.tool_key}</span>
                            <span className="step-desc">{step.expected_outcome || "—"}</span>
                            <span className={`step-status ${step.status}`}>{step.status}</span>
                            {step.duration_ms && <span className="step-duration">{step.duration_ms}ms</span>}
                            {step.error && <span className="step-error" title={step.error}>⚠</span>}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <ol>
                        {task.plan.map((step, index) => (
                          <li key={step.id} className={`step-row ${index < task.current_step ? "completed" : index === task.current_step ? "current" : "pending"}`}>
                            <span className="step-index">{index + 1}</span>
                            <span className="step-tool">{step.tool}</span>
                            <span className="step-desc">{step.description}</span>
                            <span className={`step-status ${index < task.current_step ? "completed" : index === task.current_step ? "current" : "pending"}`}>
                              {index < task.current_step ? "Done" : index === task.current_step ? "Current" : "Pending"}
                            </span>
                            {step.requiresApproval && <span className="badge approval">Needs Approval</span>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  <div className="task-actions">
                    {task.status === "queued" && (
                      <button type="button" onClick={() => startTask(task.id)} disabled={loading}>
                        Start Task
                      </button>
                    )}
                    {(task.status === "running" || task.status === "planning" || task.status === "awaiting_approval") && (
                      <button type="button" className="ghost" onClick={() => cancelTask(task.id)} disabled={loading}>
                        Cancel
                      </button>
                    )}
                    {task.status === "failed" && (
                      <button type="button" className="ghost" onClick={() => retryTask(task.id)} disabled={loading}>
                        Retry
                      </button>
                    )}
                    {task.status === "completed" && (
                      <span className="hint success">✓ Completed</span>
                    )}
                    {task.status === "cancelled" && (
                      <span className="hint">Cancelled</span>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
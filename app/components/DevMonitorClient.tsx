"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";

interface GitData {
  added?: string[];
  deleted?: string[];
  modified?: string[];
}

interface ValidationData {
  eslintErrors?: number;
  eslintWarnings?: number;
  testPassed?: number;
  testTotal?: number;
  tscErrors?: number;
}

interface FileEvent {
  id: string;
  relativePath: string;
  source: string;
  timestamp: string;
  type: string;
}

interface WatcherData {
  active: boolean;
  error: string | null;
  events: FileEvent[];
}

interface StatusData {
  branch?: string;
  changedFiles?: number;
  git?: GitData;
  gitDiffStat?: string;
  lastReport?: ValidationData | null;
  monitorEnabled?: boolean;
  regulatedAudits?: Array<{ action: string; id: string; status: string; timestamp: string; tool?: string | null }>;
  safe?: boolean;
  shortSha?: string;
  tasks?: { pending: number; running: number; completed: number; failed: number };
  timestamp?: string;
  untrackedFiles?: number;
  watcher?: WatcherData;
}

export default function DevMonitorClient({ userId }: { userId: string }) {
  const [overview, setOverview] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (paused) return;
    try {
      const response = await fetch("/api/dev-monitor/status", { credentials: "same-origin", method: "GET" });
      if (!response.ok) {
        setError(`Status endpoint returned ${response.status}`);
        return;
      }
      const json = (await response.json()) as StatusData;
      setOverview(json);
      setError(null);
      setLastRefresh(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [paused]);

  useEffect(() => {
    const scheduled = setTimeout(() => {
      void refresh();
    }, 0);
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      clearTimeout(scheduled);
      window.clearInterval(interval);
    };
  }, [refresh]);

  if (error) {
    return (
      <div className="bdm-dev-monitor bdm-dev-monitor--error">
        <h1>Development Monitor</h1>
        <p>{error}</p>
        <button onClick={() => void refresh()} type="button">Retry</button>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="bdm-dev-monitor">
        <h1>Development Monitor</h1>
        <p>Loading local development activity…</p>
      </div>
    );
  }

  const git = overview.git ?? {};
  const tasks = overview.tasks ?? { completed: 0, failed: 0, pending: 0, running: 0 };
  const events = overview.watcher?.events ?? [];

  return (
    <div className="bdm-dev-monitor">
      <header className="bdm-dev-monitor__header">
        <div>
          <h1>BDM Development Monitor</h1>
          <p>Authenticated as {userId}. Refreshing every 5 seconds.</p>
        </div>
        <button onClick={() => setPaused((value) => !value)} type="button">
          {paused ? "Resume Updates" : "Pause Updates"}
        </button>
      </header>

      <section className="bdm-dev-monitor__grid">
        <article className="bdm-dev-monitor-card">
          <h2>Branch</h2>
          <p>{overview.branch ?? "unknown"}</p>
          <p>HEAD: {overview.shortSha ?? "unknown"}</p>
        </article>
        <article className="bdm-dev-monitor-card">
          <h2>Changed Files</h2>
          <p>{overview.changedFiles ?? 0} tracked</p>
          <p>{overview.untrackedFiles ?? 0} untracked</p>
        </article>
        <article className="bdm-dev-monitor-card">
          <h2>Tasks</h2>
          <p>{tasks.pending} pending, {tasks.running} running</p>
          <p>{tasks.completed} completed, {tasks.failed} failed</p>
        </article>
        <article className="bdm-dev-monitor-card">
          <h2>Last Refresh</h2>
          <p>{lastRefresh ?? overview.timestamp ?? "never"}</p>
          <p>{overview.safe ? "Safe status" : "Status unavailable"}</p>
        </article>
      </section>

      <section className="bdm-dev-monitor-card">
        <h2>Git Changes</h2>
        <p>Modified: {git.modified?.length ?? 0}</p>
        <p>Added: {git.added?.length ?? 0}</p>
        <p>Deleted: {git.deleted?.length ?? 0}</p>
        {git.modified?.length ? <ul>{git.modified.map((file) => <li key={file}>{file}</li>)}</ul> : <p>No tracked modifications observed.</p>}
      </section>

      <section className="bdm-dev-monitor-card">
        <h2>Live File Activity</h2>
        <p>{overview.watcher?.active ? "Watching app/, lib/, tests/" : "Watcher inactive"}</p>
        {events.length ? (
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong> {event.relativePath}
                <span> — {event.timestamp}</span>
                <span> — {event.source}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No monitored file events yet.</p>
        )}
      </section>

      <section className="bdm-dev-monitor-card">
        <h2>Validation</h2>
        {overview.lastReport ? (
          <ul>
            <li>TypeScript errors: {overview.lastReport.tscErrors ?? "n/a"}</li>
            <li>ESLint errors: {overview.lastReport.eslintErrors ?? "n/a"}</li>
            <li>ESLint warnings: {overview.lastReport.eslintWarnings ?? "n/a"}</li>
            <li>Tests: {overview.lastReport.testPassed ?? "n/a"} / {overview.lastReport.testTotal ?? "n/a"}</li>
          </ul>
        ) : (
          <p>No validation report ingested yet.</p>
        )}
      </section>

    </div>
  );
}

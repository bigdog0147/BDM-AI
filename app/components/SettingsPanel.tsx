"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icons";
import type { CapabilityStatus } from "./types";
import type { HealthStatus } from "../../lib/client-status";

type Row = {
  label: string;
  value: string;
  state: "ok" | "warn" | "muted";
  detail?: string;
};

function stateLabel(state: Row["state"]): string {
  if (state === "ok") return "Configured";
  if (state === "warn") return "Not configured";
  return "Unavailable";
}

/**
 * Settings and diagnostics.
 *
 * Every row is derived from what the server actually reports. A row is only
 * labelled "Configured" when the server says the provider is configured -
 * it is never presented as a live health check, because no health check
 * was performed.
 */
export default function SettingsPanel({
  open,
  status,
  onClose
}: {
  open: boolean;
  status: CapabilityStatus | null;
  onClose: () => void;
}) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const healthResponse = await fetch("/api/health", { cache: "no-store" });
      if (healthResponse.ok) {
        setHealth((await healthResponse.json()) as HealthStatus);
      }
    } catch {
      setError("Diagnostics could not be refreshed. Check the connection.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => void check(), 0);
  }, [open, check]);

  if (!open) return null;

  const rows: Row[] = [];

  if (status) {
    rows.push({
      label: "AI engine",
      value: status.ai.configured
        ? `${status.ai.provider}${
            status.ai.model ? ` · ${status.ai.model}` : ""
          }`
        : "No provider configured",
      state: status.ai.configured ? "ok" : "warn",
      detail: status.ai.configured
        ? "The server has credentials for this provider. Availability is not live-tested here."
        : "Set the provider variables on the server to enable replies."
    });

    if (status.ai.fallback?.provider) {
      rows.push({
        label: "Fallback engine",
        value: `${status.ai.fallback.provider}${
          status.ai.fallback.configured ? "" : " · not configured"
        }`,
        state: status.ai.fallback.configured ? "ok" : "warn",
        detail: "Only used when the primary provider fails for a transient reason."
      });
    }

    rows.push({
      label: "Web research",
      value: status.search.configured
        ? `${status.search.provider}`
        : "No search provider configured",
      state: status.search.configured ? "ok" : "warn",
      detail: status.search.configured
        ? "Research sends only the question you type."
        : "Add a search provider key on the server to enable research."
    });

    rows.push({
      label: "Voice notes",
      value: status.voice.configured
        ? `${status.voice.provider}${
            status.voice.model ? ` · ${status.voice.model}` : ""
          }`
        : "No transcription provider configured",
      state: status.voice.configured ? "ok" : "warn",
      detail: status.voice.configured
        ? `Audio is held in memory for one request and never stored (${status.voice.retention}). Maximum ${status.voice.maxDurationSeconds}s.`
        : "Recording stays disabled. Type your message instead."
    });

    rows.push({
      label: "Image generation",
      value: status.images.configured
        ? `${status.images.provider}${
            status.images.model ? ` · ${status.images.model}` : ""
          }`
        : "Not configured",
      state: status.images.configured ? "ok" : "muted"
    });

    rows.push({
      label: "Email",
      value: status.email?.configured
        ? `${status.email.provider}`
        : status.email?.enabled
          ? "Enabled but not configured"
          : "Not configured",
      state: status.email?.configured ? "ok" : "muted"
    });

    rows.push({
      label: "Long-term memory",
      value: status.memory.available ? "Available" : "Sign in to use memory",
      state: status.memory.available ? "ok" : "muted"
    });
  }

  if (status?.google) {
    const google = status.google;
    rows.push({
      label: "Google sign-in",
      value: google.configured
        ? google.linked
          ? "Enabled and connected to this account"
          : "Enabled on the auth server"
        : !google.credentialsConfigured
          ? "OAuth client is not configured"
          : "Identity guard is not configured",
      state: google.configured ? "ok" : "warn",
      detail: google.configured
        ? "Google sign-in is offered on the sign-in and sign-up screens. BDM never links a Google identity to a password account on email equality alone."
        : "The owner still has to finish the Google and Supabase configuration (see Account settings)."
    });
  }

  return (
    <section className="panel settings" aria-label="Settings and diagnostics">
      <div className="panel-head">
        <div>
          <strong className="panel-title">Settings</strong>
          <p className="hint panel-hint">
            Configuration reported by the server. Secrets never leave the
            server.
          </p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="settings-section">
        <h3 className="settings-heading">Capabilities</h3>
        {rows.length === 0 ? (
          <p className="hint">Status is still loading…</p>
        ) : (
          <ul className="settings-list">
            {rows.map((row) => (
              <li key={row.label} className="settings-row">
                <span className="settings-label">{row.label}</span>
                <span className="settings-value">{row.value}</span>
                <span className={`chip ${row.state}`}>{stateLabel(row.state)}</span>
                {row.detail ? (
                  <span className="settings-detail">{row.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="settings-section">
        <h3 className="settings-heading">Application health</h3>
        {health ? (
          <p className="settings-health">
            <Icon name="shield" size={16} />
            <span>
              {health.service} v{health.version} responded at {health.time}
            </span>
          </p>
        ) : (
          <p className="hint">The health endpoint has not answered yet.</p>
        )}
        {error ? <p className="notice error">{error}</p> : null}
        <div className="panel-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => void check()}
            disabled={checking}
          >
            <Icon name="retry" size={15} />
            {checking ? "Checking…" : "Re-check"}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-heading">Account</h3>
        <p className="hint">
          Connect Google, review the sign-in methods on this account, and see
          the exact callback URL to register in Google Cloud Console.
        </p>
        <div className="panel-actions">
          <a className="btn ghost" href="/settings">
            <Icon name="user" size={15} />
            Open account settings
          </a>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-heading">Privacy</h3>
        <p className="hint">
          Provider keys live only in the server environment. Recordings and
          research queries are sent to the provider that needs them and are
          not stored by BDM.
        </p>
      </div>
    </section>
  );
}

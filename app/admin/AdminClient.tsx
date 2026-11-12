"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import BrandLogo from "../components/BrandLogo";
import { Icon } from "../components/Icons";

interface AdminOverview {
  admin: {
    role: string;
    user: { id: string; email: string } | null;
    isDev: boolean;
  };
  system: {
    nodeVersion: string;
    platform: string;
    arch: string;
    pid: number;
    uptimeSeconds: number;
    memory: {
      heapUsedMb: number;
      heapTotalMb: number;
      rssMb: number;
    };
    environment: string;
  };
  security: {
    firewall: {
      status: string;
      mode: string;
      protections: string[];
    };
    privateViewProtected: boolean;
  };
  services: {
    supabase: {
      configured: boolean;
      connected: boolean;
      latencyMs: number | null;
      url: string;
    };
    googleOAuth: {
      configured: boolean;
      storeConfigured: boolean;
    };
    githubAuth: {
      storeConfigured: boolean;
    };
    email: {
      provider: string;
      configured: boolean;
      apiKeySet: boolean;
      fromAddressSet: boolean;
    };
    search: {
      provider: string;
      configured: boolean;
    };
    images: {
      provider: string;
      configured: boolean;
    };
    voice: {
      provider: string;
      model: string;
      configured: boolean;
    };
    aiGateway: {
      provider: string;
      model: string;
      configured: boolean;
    };
    jarvisBridge: {
      connected: boolean;
      endpoint: string;
      telemetry: any;
    };
  };
  externalMemory: {
    exists: boolean;
    path: string;
    sizeBytes: number;
    lastModified: string | null;
    memoriesCount: number;
    tasksCount: number;
    learningsCount: number;
  };
  quotas: any;
  diagnosticsSummary: {
    requiredConfigured: number;
    requiredTotal: number;
    optionalConfigured: number;
  };
}

interface AuditEvent {
  id: string;
  event_type: string;
  action: string;
  status: string;
  tool_key?: string;
  details?: Record<string, unknown>;
  created_at: string;
}

type TabKey =
  | "overview"
  | "security"
  | "services"
  | "audit"
  | "gateway"
  | "tasks"
  | "memory";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function AdminClient() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [data, setData] = useState<AdminOverview | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passcode, setPasscode] = useState("");
  const [isRefreshing, startTransition] = useTransition();
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncWithJarvis = async (action: string) => {
    setIsSyncing(true);
    setSyncStatusMsg(null);
    try {
      const res = await fetch("/api/jarvis/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          text:
            action === "add_memory"
              ? "BDM AI workspace verified with Google login (djbigdog22@gmail.com) and full multimodal mesh."
              : undefined
        })
      });
      const json = await res.json();
      if (json.ok) {
        setSyncStatusMsg(
          action === "add_memory"
            ? "Memory checkpoint successfully saved to BIG DOG / JARVIS external drive!"
            : "Synchronized successfully with BIG DOG · J.A.R.V.I.S. external drive!"
        );
        loadData();
      } else {
        setSyncStatusMsg(json.error || "Sync failed");
      }
    } catch {
      setSyncStatusMsg("Network error connecting to external memory.");
    } finally {
      setIsSyncing(false);
    }
  };

  const loadData = async (customPasscode?: string) => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (customPasscode || passcode) {
        headers["x-admin-passcode"] = customPasscode || passcode;
      }

      const [resOverview, resAudit, resTasks] = await Promise.all([
        fetch("/api/admin/overview", { headers }),
        fetch("/api/admin/audit", { headers }),
        fetch("/api/admin/tasks", { headers })
      ]);

      if (!resOverview.ok) {
        const errJson = await resOverview.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${resOverview.status}: Access Denied`);
      }

      const overviewJson = await resOverview.json();
      const auditJson = await resAudit.json().catch(() => ({ events: [] }));
      const tasksJson = await resTasks.json().catch(() => ({ tasks: [] }));

      setData(overviewJson);
      setAuditEvents(auditJson.events || []);
      setTasks(tasksJson.tasks || []);
    } catch (err: any) {
      setError(err.message || "Failed to load administration telemetry.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefresh = () => {
    startTransition(() => {
      loadData();
    });
  };

  const handlePasscodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) return;
    loadData(passcode.trim());
  };

  if (loading && !data) {
    return (
      <main className="settings-page">
        <div className="settings-container">
          <div className="settings-banner" style={{ textAlign: "center", padding: "4rem 1rem" }}>
            <BrandLogo variant="emblem" size={48} />
            <h2 style={{ marginTop: "1rem" }}>Loading BDM Administration Telemetry...</h2>
            <p className="subtle">Verifying credentials and polling system sensors.</p>
          </div>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="settings-page">
        <div className="settings-container">
          <header className="settings-header">
            <Link href="/" className="back-link">
              <span style={{ display: "inline-block", transform: "rotate(180deg)" }}>
                <Icon name="arrow" size={16} />
              </span>{" "}
              Back to Workspace
            </Link>
            <div className="settings-title-row">
              <BrandLogo variant="emblem" size={32} />
              <div className="settings-title-copy">
                <h1>BDM Administration Portal</h1>
                <p>Restricted command center for personal AI operations and security.</p>
              </div>
            </div>
          </header>

          <section className="settings-card" style={{ borderColor: "var(--color-danger, #ef4444)" }}>
            <div className="settings-card-head">
              <h2>
                <Icon name="shield" size={20} /> Access Restricted
              </h2>
              <span className="chip warn">Locked</span>
            </div>
            <p style={{ marginTop: "0.5rem", color: "var(--color-fg-muted)" }}>
              {error}
            </p>

            <form onSubmit={handlePasscodeSubmit} style={{ marginTop: "1.5rem", maxWidth: "420px" }}>
              <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                Emergency Admin Passcode
              </label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="password"
                  placeholder="Enter passcode..."
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "0.5rem 0.75rem",
                    background: "var(--color-bg-subtle, #18181b)",
                    border: "1px solid var(--color-border, #27272a)",
                    borderRadius: "6px",
                    color: "inherit"
                  }}
                />
                <button type="submit" className="button primary">
                  Unlock
                </button>
              </div>
              <div style={{ marginTop: "1rem" }}>
                <Link href="/auth" className="button secondary">
                  Sign In with Google
                </Link>
              </div>
            </form>
          </section>
        </div>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="settings-page">
      <div className="settings-container" style={{ maxWidth: "1280px" }}>
        {/* Top Header */}
        <header className="settings-header">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Link href="/" className="back-link">
              <span style={{ display: "inline-block", transform: "rotate(180deg)" }}>
                <Icon name="arrow" size={16} />
              </span>{" "}
              Back to Workspace
            </Link>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <span className="chip ok" style={{ textTransform: "uppercase" }}>
                <Icon name="check" size={14} /> {data.admin.role}
              </span>
              <span className="chip ok">
                <Icon name="shield" size={14} /> WAF {data.security.firewall.status}
              </span>
              <button
                type="button"
                className="button secondary"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title="Refresh live telemetry"
                style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem" }}
              >
                <Icon name="retry" size={14} /> {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="settings-title-row" style={{ marginTop: "1.25rem" }}>
            <BrandLogo variant="emblem" size={38} />
            <div className="settings-title-copy">
              <h1>BDM Administration & Operations Fleet</h1>
              <p>
                Host telemetry, Web Application Firewall enforcement, and multi-model AI routing mesh.
              </p>
            </div>
          </div>
        </header>

        {/* Quick KPI Stat Strip */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem",
            marginBottom: "1.5rem"
          }}
        >
          <div className="capability-card" style={{ padding: "1rem" }}>
            <span className="subtle" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>
              Core Runtime
            </span>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }}>
              {data.system.nodeVersion}
            </div>
            <span className="subtle" style={{ fontSize: "0.8rem" }}>
              {data.system.platform} ({data.system.arch}) · Uptime: {formatUptime(data.system.uptimeSeconds)}
            </span>
          </div>

          <div className="capability-card" style={{ padding: "1rem" }}>
            <span className="subtle" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>
              Process Memory (Heap)
            </span>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }}>
              {data.system.memory.heapUsedMb} MB / {data.system.memory.heapTotalMb} MB
            </div>
            <span className="subtle" style={{ fontSize: "0.8rem" }}>
              RSS: {data.system.memory.rssMb} MB · PID: {data.system.pid}
            </span>
          </div>

          <div className="capability-card" style={{ padding: "1rem" }}>
            <span className="subtle" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>
              Supabase Database
            </span>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }}>
              {data.services.supabase.connected ? "CONNECTED" : "OFFLINE"}
            </div>
            <span className="subtle" style={{ fontSize: "0.8rem" }}>
              {data.services.supabase.latencyMs ? `${data.services.supabase.latencyMs}ms roundtrip` : "Connection unverified"}
            </span>
          </div>

          <div className="capability-card" style={{ padding: "1rem" }}>
            <span className="subtle" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>
              Jarvis Bridge (Port 8787)
            </span>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }}>
              {data.services.jarvisBridge.connected ? "LINKED & ONLINE" : "STANDBY / UNREACHABLE"}
            </div>
            <span className="subtle" style={{ fontSize: "0.8rem" }}>
              {data.services.jarvisBridge.telemetry?.brain || "Local Bridge"} · ws://127.0.0.1:8787
            </span>
          </div>
        </section>

        {/* Tab Navigation */}
        <nav
          style={{
            display: "flex",
            gap: "0.5rem",
            borderBottom: "1px solid var(--color-border, #27272a)",
            paddingBottom: "0.5rem",
            marginBottom: "1.5rem",
            overflowX: "auto"
          }}
        >
          {[
            { key: "overview", label: "Overview & Sensors", icon: "sparkle" },
            { key: "security", label: "Security & WAF", icon: "shield" },
            { key: "services", label: "Service Mesh", icon: "globe" },
            { key: "audit", label: `Audit Events (${auditEvents.length})`, icon: "memory" },
            { key: "gateway", label: "AI Models & Gateway", icon: "code" },
            { key: "tasks", label: `Tasks Fleet (${tasks.length})`, icon: "history" },
            { key: "memory", label: "External Memory Bank", icon: "sparkle" }
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`button ${activeTab === tab.key ? "primary" : "secondary"}`}
              onClick={() => setActiveTab(tab.key as TabKey)}
              style={{
                borderRadius: "8px",
                padding: "0.5rem 0.9rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.85rem"
              }}
            >
              <Icon name={tab.icon as any} size={15} />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* TAB 1: OVERVIEW */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <section className="settings-card">
              <div className="settings-card-head">
                <h2>
                  <Icon name="sparkle" size={20} /> Host Node & Container Diagnostics
                </h2>
                <span className="chip ok">Healthy</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
                <div style={{ background: "var(--color-bg-subtle, #121214)", padding: "1rem", borderRadius: "8px" }}>
                  <span className="subtle" style={{ fontSize: "0.8rem" }}>Operating System</span>
                  <div style={{ fontWeight: 600 }}>{data.system.platform} ({data.system.arch})</div>
                </div>
                <div style={{ background: "var(--color-bg-subtle, #121214)", padding: "1rem", borderRadius: "8px" }}>
                  <span className="subtle" style={{ fontSize: "0.8rem" }}>Node.js Runtime</span>
                  <div style={{ fontWeight: 600 }}>{data.system.nodeVersion}</div>
                </div>
                <div style={{ background: "var(--color-bg-subtle, #121214)", padding: "1rem", borderRadius: "8px" }}>
                  <span className="subtle" style={{ fontSize: "0.8rem" }}>App Environment</span>
                  <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{data.system.environment}</div>
                </div>
                <div style={{ background: "var(--color-bg-subtle, #121214)", padding: "1rem", borderRadius: "8px" }}>
                  <span className="subtle" style={{ fontSize: "0.8rem" }}>Environment Variables Checklist</span>
                  <div style={{ fontWeight: 600 }}>
                    {data.diagnosticsSummary.requiredConfigured} / {data.diagnosticsSummary.requiredTotal} Required OK
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: SECURITY & WAF */}
        {activeTab === "security" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <section className="settings-card">
              <div className="settings-card-head">
                <h2>
                  <Icon name="shield" size={20} /> BDM Web Application Firewall (WAF)
                </h2>
                <span className="chip ok">ENFORCING</span>
              </div>
              <p style={{ marginTop: "0.5rem", color: "var(--color-fg-muted)" }}>
                The BDM WAF operates at the edge via proxy.ts, filtering malicious traffic, rate-limiting API endpoints, and protecting internal diagnostics.
              </p>
              <div style={{ marginTop: "1rem" }}>
                <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>Active Edge Protection Shields:</h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {data.security.firewall.protections.map((p, idx) => (
                    <li
                      key={idx}
                      style={{
                        padding: "0.6rem 0.9rem",
                        background: "var(--color-bg-subtle, #121214)",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.6rem",
                        borderLeft: "3px solid var(--color-success, #22c55e)"
                      }}
                    >
                      <Icon name="check" size={15} />
                      <span style={{ fontSize: "0.9rem" }}>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: SERVICES MESH */}
        {activeTab === "services" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem" }}>
            <div className="capability-card">
              <div className="capability-icon"><Icon name="globe" size={18} /></div>
              <div className="capability-copy">
                <div className="capability-title">
                  <strong>Supabase Database & Auth</strong>
                  <span className={`chip ${data.services.supabase.connected ? "ok" : "warn"}`}>
                    {data.services.supabase.connected ? "Online" : "Missing / Offline"}
                  </span>
                </div>
                <p>PostgreSQL schema, conversation persistence, and session security.</p>
              </div>
            </div>

            <div className="capability-card">
              <div className="capability-icon"><Icon name="shield" size={18} /></div>
              <div className="capability-copy">
                <div className="capability-title">
                  <strong>Google OAuth 2.0</strong>
                  <span className={`chip ${data.services.googleOAuth.configured ? "ok" : "warn"}`}>
                    {data.services.googleOAuth.configured ? "Configured" : "Unconfigured"}
                  </span>
                </div>
                <p>Single sign-on with verified email and identity store protection.</p>
              </div>
            </div>

            <div className="capability-card">
              <div className="capability-icon"><Icon name="sparkle" size={18} /></div>
              <div className="capability-copy">
                <div className="capability-title">
                  <strong>AI Gateway (Active Core)</strong>
                  <span className={`chip ${data.services.aiGateway.configured ? "ok" : "warn"}`}>
                    {data.services.aiGateway.provider}
                  </span>
                </div>
                <p>Primary model: {data.services.aiGateway.model || "None configured"}</p>
              </div>
            </div>

            <div className="capability-card">
              <div className="capability-icon"><Icon name="mail" size={18} /></div>
              <div className="capability-copy">
                <div className="capability-title">
                  <strong>Email Service (Resend)</strong>
                  <span className={`chip ${data.services.email.configured ? "ok" : "warn"}`}>
                    {data.services.email.configured ? "Ready" : "Not Set"}
                  </span>
                </div>
                <p>Transactional delivery & webhook event synchronization.</p>
              </div>
            </div>

            <div className="capability-card">
              <div className="capability-icon"><Icon name="mic" size={18} /></div>
              <div className="capability-copy">
                <div className="capability-title">
                  <strong>Voice Note Transcription</strong>
                  <span className={`chip ${data.services.voice.configured ? "ok" : "warn"}`}>
                    {data.services.voice.configured ? data.services.voice.provider : "Disabled"}
                  </span>
                </div>
                <p>Audio voice-to-text with whisper-1 model.</p>
              </div>
            </div>

            <div className="capability-card">
              <div className="capability-icon"><Icon name="image" size={18} /></div>
              <div className="capability-copy">
                <div className="capability-title">
                  <strong>Image Generation</strong>
                  <span className={`chip ${data.services.images.configured ? "ok" : "warn"}`}>
                    {data.services.images.configured ? data.services.images.provider : "Disabled"}
                  </span>
                </div>
                <p>DALL-E 3 image generation engine.</p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: AUDIT EVENTS */}
        {activeTab === "audit" && (
          <section className="settings-card">
            <div className="settings-card-head">
              <h2>
                <Icon name="memory" size={20} /> Security & System Audit Event Log
              </h2>
              <span className="chip ok">{auditEvents.length} Events Logged</span>
            </div>
            <div style={{ overflowX: "auto", marginTop: "1rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border, #27272a)", textAlign: "left", color: "var(--color-fg-muted)" }}>
                    <th style={{ padding: "0.5rem" }}>Timestamp</th>
                    <th style={{ padding: "0.5rem" }}>Type</th>
                    <th style={{ padding: "0.5rem" }}>Action</th>
                    <th style={{ padding: "0.5rem" }}>Target / Tool</th>
                    <th style={{ padding: "0.5rem" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEvents.map((evt) => (
                    <tr key={evt.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "0.6rem 0.5rem", whiteSpace: "nowrap" }}>
                        {new Date(evt.created_at).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem", textTransform: "uppercase" }}>{evt.event_type}</td>
                      <td style={{ padding: "0.6rem 0.5rem" }}>{evt.action}</td>
                      <td style={{ padding: "0.6rem 0.5rem", fontFamily: "monospace" }}>{evt.tool_key || "system"}</td>
                      <td style={{ padding: "0.6rem 0.5rem" }}>
                        <span className={`chip ${evt.status === "success" ? "ok" : "warn"}`} style={{ fontSize: "0.75rem" }}>
                          {evt.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* TAB 5: AI GATEWAY */}
        {activeTab === "gateway" && (
          <section className="settings-card">
            <div className="settings-card-head">
              <h2>
                <Icon name="code" size={20} /> Multi-Model AI Gateway Fleet
              </h2>
              <span className="chip ok">Ready</span>
            </div>
            <p style={{ marginTop: "0.5rem", color: "var(--color-fg-muted)" }}>
              Manage dynamic model routing across local Ollama instances, OpenRouter aggregators, and direct Anthropic/OpenAI connections.
            </p>
            <div style={{ marginTop: "1.5rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
              <div style={{ background: "var(--color-bg-subtle, #121214)", padding: "1rem", borderRadius: "8px" }}>
                <span className="subtle" style={{ fontSize: "0.8rem" }}>Active Production Model</span>
                <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "0.25rem" }}>
                  {data.services.aiGateway.provider} · {data.services.aiGateway.model || "Default"}
                </div>
              </div>
              <div style={{ background: "var(--color-bg-subtle, #121214)", padding: "1rem", borderRadius: "8px" }}>
                <span className="subtle" style={{ fontSize: "0.8rem" }}>Local Assistant Bridge</span>
                <div style={{ fontWeight: 600, fontSize: "1.1rem", marginTop: "0.25rem" }}>
                  {data.services.jarvisBridge.connected ? "ONLINE (Port 8787)" : "OFFLINE"}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TAB 6: TASKS FLEET */}
        {activeTab === "tasks" && (
          <section className="settings-card">
            <div className="settings-card-head">
              <h2>
                <Icon name="history" size={20} /> Fleet Tasks & Autonomous Workflows
              </h2>
              <span className="chip ok">{tasks.length} Tracked</span>
            </div>
            <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {tasks.length === 0 ? (
                <p className="subtle">No active background tasks in the queue.</p>
              ) : (
                tasks.map((t, idx) => (
                  <div
                    key={t.id || idx}
                    style={{
                      padding: "0.8rem 1rem",
                      background: "var(--color-bg-subtle, #121214)",
                      borderRadius: "6px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.title || t.id}</div>
                      <span className="subtle" style={{ fontSize: "0.8rem" }}>
                        Created: {new Date(t.created_at || Date.now()).toLocaleString()}
                      </span>
                    </div>
                    <span className={`chip ${t.status === "completed" ? "ok" : "warn"}`}>
                      {t.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* TAB 7: EXTERNAL MEMORY */}
        {activeTab === "memory" && (
          <section className="settings-card">
            <div className="settings-card-head">
              <h2>
                <Icon name="sparkle" size={20} /> External Drive Persistent Memory Bank
              </h2>
              <span className={`chip ${data.externalMemory.exists ? "ok" : "warn"}`}>
                {data.externalMemory.exists ? "MOUNTED & ACTIVE" : "DISCONNECTED"}
              </span>
            </div>
            <p style={{ marginTop: "0.5rem", color: "var(--color-fg-muted)" }}>
              Continuous learning and long-term memory records for BIG DOG · J.A.R.V.I.S. stored on your local drive.
            </p>
            <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
              <div style={{ background: "var(--color-bg-subtle, #121214)", padding: "1rem", borderRadius: "8px" }}>
                <span className="subtle" style={{ fontSize: "0.8rem" }}>Storage Location</span>
                <div style={{ fontWeight: 600, fontFamily: "monospace", fontSize: "0.85rem", marginTop: "0.25rem", wordBreak: "break-all" }}>
                  {data.externalMemory.path}
                </div>
              </div>
              <div style={{ background: "var(--color-bg-subtle, #121214)", padding: "1rem", borderRadius: "8px" }}>
                <span className="subtle" style={{ fontSize: "0.8rem" }}>File Size & Last Modified</span>
                <div style={{ fontWeight: 600, marginTop: "0.25rem" }}>
                  {formatBytes(data.externalMemory.sizeBytes)} · {data.externalMemory.lastModified ? new Date(data.externalMemory.lastModified).toLocaleTimeString() : "N/A"}
                </div>
              </div>
              <div style={{ background: "var(--color-bg-subtle, #121214)", padding: "1rem", borderRadius: "8px" }}>
                <span className="subtle" style={{ fontSize: "0.8rem" }}>Stored Continuous Learnings</span>
                <div style={{ fontWeight: 700, fontSize: "1.2rem", marginTop: "0.25rem" }}>
                  {data.externalMemory.learningsCount} Turns
                </div>
              </div>
              <div style={{ background: "var(--color-bg-subtle, #121214)", padding: "1rem", borderRadius: "8px" }}>
                <span className="subtle" style={{ fontSize: "0.8rem" }}>Persistent Tasks & Memories</span>
                <div style={{ fontWeight: 700, fontSize: "1.2rem", marginTop: "0.25rem" }}>
                  {data.externalMemory.memoriesCount} Memories · {data.externalMemory.tasksCount} Tasks
                </div>
              </div>
            </div>

            <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                className="button primary"
                onClick={() => handleSyncWithJarvis("sync_check")}
                disabled={isSyncing}
              >
                <Icon name="retry" size={15} /> {isSyncing ? "Syncing..." : "Sync with BIG DOG · J.A.R.V.I.S."}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => handleSyncWithJarvis("add_memory")}
                disabled={isSyncing}
              >
                <Icon name="sparkle" size={15} /> Save BDM Checkpoint Memory to Drive
              </button>
              {syncStatusMsg && (
                <span className="chip ok" style={{ marginLeft: "0.5rem" }}>
                  {syncStatusMsg}
                </span>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

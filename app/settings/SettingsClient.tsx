"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, GoogleIcon } from "../components/Icons";
import BrandLogo from "../components/BrandLogo";
import type { AuthUser, CapabilityStatus } from "../components/types";

const GOOGLE_ERRORS: Record<string, string> = {
  google_not_configured:
    "Google sign-in is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.",
  google_store_not_configured:
    "The Google identity guard is unavailable. Add SUPABASE_SERVICE_ROLE_KEY and apply the 0004 Google identities migration.",
  google_account_exists:
    "An account with that email already exists. Sign in with your password first, then connect Google here. BDM never links by email alone.",
  google_email_mismatch:
    "The verified Google email must match the email on your signed-in BDM account.",
  google_already_linked:
    "That Google account is already connected to another BDM account.",
  google_cancelled: "Google sign-in was cancelled before it completed.",
  google_denied: "Google did not grant access.",
  google_state:
    "The sign-in attempt expired or could not be verified. Please try again.",
  google_token_exchange: "Google did not complete the token exchange. Please try again.",
  google_token_invalid: "Google's identity token could not be verified.",
  google_email_unverified: "Google did not confirm this email as verified.",
  google_nonce: "The sign-in attempt could not be verified. Please try again.",
  google_sign_in_failed:
    "Google verified you, but Supabase could not create the session. Confirm the Google provider is enabled in Supabase Auth.",
  google_account_mismatch:
    "The Google account did not match the expected BDM account. No session was created.",
  google_link_failed: "The Google account could not be linked. Nothing was changed.",
  google_account_failed:
    "The BDM account could not be created. No session was created.",
  google_sign_in_required: "Sign in to BDM first, then connect Google from this page.",
  auth_not_configured: "Supabase Auth is not configured on this server.",
  google_redirect_uri:
    "The Google redirect URI is invalid. Use HTTPS, or localhost during development."
};

const GROUP_ORDER = [
  "AI",
  "Research",
  "Voice",
  "Images",
  "Auth",
  "Google",
  "Email"
] as const;

function Capability({
  icon,
  title,
  status,
  detail,
  ok
}: {
  icon: "sparkle" | "globe" | "mic" | "image" | "mail" | "memory" | "shield";
  title: string;
  status: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <div className="capability-card">
      <div className="capability-icon">
        <Icon name={icon} size={18} />
      </div>
      <div className="capability-copy">
        <div className="capability-title">
          <strong>{title}</strong>
          <span className={`chip ${ok ? "ok" : "warn"}`}>
            {ok ? "Ready" : "Not configured"}
          </span>
        </div>
        <span className="capability-status">{status}</span>
        <p>{detail}</p>
      </div>
    </div>
  );
}

export default function SettingsClient() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser>(null);
  const [status, setStatus] = useState<CapabilityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, statusRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/status")
        ]);
        const me = (await meRes.json()) as { user?: AuthUser };
        const capabilities = (await statusRes.json()) as CapabilityStatus;
        if (cancelled) return;
        setUser(me.user ?? null);
        setStatus(capabilities);
      } catch {
        if (!cancelled) setError("Settings could not be loaded. Try refreshing.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "linked") {
      setTimeout(() => setNotice("Google is now connected to this account."), 0);
    }
    const googleError = params.get("google_error");
    if (googleError) {
      setTimeout(
        () =>
          setError(
            GOOGLE_ERRORS[googleError] ?? "Google sign-in could not complete."
          ),
        0
      );
    }
  }, []);

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/auth");
    router.refresh();
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Could not copy automatically. Select the value and copy it manually.");
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportStatus({ ok: true, message: "Importing…" });

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data || data.version !== 1) {
        throw new Error("Invalid export format (expected version 1)");
      }

      const response = await fetch("/api/conversations/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data)
      });

      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        imported?: {
          conversations?: number;
          messages?: number;
          memories?: number;
        };
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Import failed");
      }

      setImportStatus({
        ok: true,
        message: `Imported ${result.imported?.conversations ?? 0} conversations, ${
          result.imported?.messages ?? 0
        } messages, ${result.imported?.memories ?? 0} memories.`
      });
    } catch (err) {
      setImportStatus({
        ok: false,
        message: err instanceof Error ? err.message : "Import failed"
      });
    } finally {
      event.target.value = "";
      window.setTimeout(() => setImportStatus(null), 8000);
    }
  }

  const google = status?.google;
  const providers = user?.providers ?? google?.providers ?? [];
  const googleConnected = Boolean(
    user && (google?.linked || providers.includes("google"))
  );

  const environment = useMemo(
    () => status?.environment ?? [],
    [status?.environment]
  );
  const groupedEnvironment = useMemo(() => {
    const groups = new Map<string, typeof environment>();
    for (const item of environment) {
      const list = groups.get(item.group) ?? [];
      list.push(item);
      groups.set(item.group, list);
    }
    return GROUP_ORDER.filter((group) => groups.has(group)).map((group) => ({
      group,
      items: groups.get(group) ?? []
    }));
  }, [environment]);

  const missingRequired = environment.filter(
    (item) => item.kind === "required" && !item.present
  );
  const missingOptional = environment.filter(
    (item) => item.kind !== "required" && !item.present
  );

  return (
    <main className="settings-page">
      <header className="settings-topbar">
        <Link href="/" className="back-link">
          <Icon name="chevron" size={16} />
          Back to workspace
        </Link>
        <BrandLogo variant="mark" size={26} decorative />
      </header>

      <div className="settings-wrap">
        <div className="settings-intro">
          <div className="eyebrow">
            <Icon name="settings" size={14} />
            Workspace controls
          </div>
          <h1>Settings</h1>
          <p>
            Account, connections, and the honest capability report for this
            deployment. Technical details live here, not on your home screen.
          </p>
        </div>

        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice ok" role="status">
            {notice}
          </div>
        )}

        <section className="settings-section" aria-labelledby="account-heading">
          <div className="section-head">
            <div>
              <h2 id="account-heading">Account</h2>
              <p>The existing Supabase account and secure cookie session.</p>
            </div>
            {user && (
              <button type="button" className="btn ghost" onClick={signOut}>
                <Icon name="logout" size={15} />
                Sign out
              </button>
            )}
          </div>

          {loading ? (
            <div className="skeleton-block" aria-label="Loading account" />
          ) : user ? (
            <div className="account-panel">
              <span className="avatar large" aria-hidden="true">
                {(user.email?.[0] ?? "B").toUpperCase()}
              </span>
              <div className="account-details">
                <strong>{user.email ?? "Signed in"}</strong>
                <span>User ID · {user.id.slice(0, 8)}…</span>
                <div className="provider-row">
                  {providers.length > 0 ? (
                    providers.map((provider) => (
                      <span className="pill" key={provider}>
                        {provider === "email" ? "Password" : provider}
                      </span>
                    ))
                  ) : (
                    <span className="pill">Supabase session</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-account">
              <Icon name="user" size={22} />
              <div>
                <strong>You are signed out.</strong>
                <p>Sign in to sync conversations, memory, and research history.</p>
              </div>
              <Link className="btn primary" href="/auth">
                Sign in
              </Link>
            </div>
          )}
        </section>

        <section className="settings-section" aria-labelledby="google-heading">
          <div className="section-head">
            <div>
              <h2 id="google-heading">Google</h2>
              <p>
                Server-verified OIDC. BDM never links Google to a password
                account just because the email matches.
              </p>
            </div>
            <span className={`status-pill ${google?.configured ? "ok" : "warn"}`}>
              {google?.configured ? "Configured" : "Not configured"}
            </span>
          </div>

          <div className="google-panel">
            <div className="google-copy">
              <div className="google-title">
                <span className="google-mark">
                  <GoogleIcon size={20} />
                </span>
                <div>
                  <strong>
                    {googleConnected ? "Google is connected" : "Connect Google"}
                  </strong>
                  <span>
                    {googleConnected
                      ? "You can sign in with this Google account."
                      : "Use Google for faster sign-in without creating a separate password."}
                  </span>
                </div>
              </div>
              <ul className="check-list">
                <li>
                  <Icon name="check" size={14} />
                  ID token signature, issuer, audience, expiry, and nonce are
                  verified server-side.
                </li>
                <li>
                  <Icon name="check" size={14} />
                  Only a verified Google email can create or link an account.
                </li>
                <li>
                  <Icon name="check" size={14} />
                  Existing password accounts must sign in first before linking.
                </li>
              </ul>
            </div>

            <div className="google-actions">
              {!user ? (
                <Link className="btn primary" href="/auth">
                  Sign in to connect
                </Link>
              ) : googleConnected ? (
                <span className="connected-badge">
                  <Icon name="check" size={15} />
                  Connected
                </span>
              ) : google?.configured ? (
                <a className="btn ghost" href="/api/auth/google/start?mode=link">
                  <GoogleIcon size={17} />
                  Connect Google
                </a>
              ) : (
                <span className="btn disabled" aria-disabled="true">
                  <GoogleIcon size={17} />
                  Unavailable
                </span>
              )}
            </div>
          </div>

          {!google?.credentialsConfigured && (
            <p className="notice warn">
              Add <code>GOOGLE_CLIENT_ID</code> and{" "}
              <code>GOOGLE_CLIENT_SECRET</code> to the server environment, then
              restart the service.
            </p>
          )}
          {!google?.identityStoreConfigured && (
            <p className="notice warn">
              Add <code>SUPABASE_SERVICE_ROLE_KEY</code> and apply{" "}
              <code>supabase/migrations/0004_google_identities.sql</code>. Google
              sign-in stays disabled until the no-silent-linking guard is
              available.
            </p>
          )}

          {google?.callbackUrl ? (
            <div className="callback-box">
              <div>
                <span className="field-label">
                  Authorized redirect URI — register this exact value
                </span>
                <code>{google.callbackUrl}</code>
                {google.origin ? (
                  <>
                    <span className="field-label callback-extra">
                      Authorized JavaScript origin
                    </span>
                    <code>{google.origin}</code>
                  </>
                ) : null}
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => void copyText("callback", google.callbackUrl ?? "")}
              >
                <Icon name={copied === "callback" ? "check" : "copy"} size={16} />
                <span className="sr-only">Copy redirect URI</span>
              </button>
            </div>
          ) : null}

          <p className="hint">
            In Google Cloud Console, create a Web application OAuth client and
            add the redirect URI above. Then enable the Google provider in
            Supabase Auth with the same client ID and secret: the session is
            still issued by Supabase, so BDM does not run a second auth system.
          </p>
        </section>

        <section className="settings-section" aria-labelledby="github-heading">
          <div className="section-head">
            <div>
              <h2 id="github-heading">GitHub</h2>
              <p>OAuth sign-in with server-side identity guard.</p>
            </div>
            <span className="status-pill ok">Configured</span>
          </div>
          <div className="google-panel">
            <p className="hint">Link logic uses <code>bdm_github_identities</code> (migration 0005). Add <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>, and <code>SUPABASE_SERVICE_ROLE_KEY</code> to the server.</p>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="capabilities-heading">
          <div className="section-head">
            <div>
              <h2 id="capabilities-heading">Capabilities</h2>
              <p>Provider readiness reported by the server. No secrets are shown.</p>
            </div>
            <Link className="btn ghost" href="/api/status" target="_blank">
              <Icon name="external" size={15} />
              Raw status
            </Link>
          </div>

          {loading ? (
            <div className="capability-grid">
              <div className="skeleton-block" />
              <div className="skeleton-block" />
              <div className="skeleton-block" />
            </div>
          ) : status ? (
            <div className="capability-grid">
              <Capability
                icon="sparkle"
                title="Assistant"
                ok={status.ai.configured}
                status={
                  status.ai.configured
                    ? `${status.ai.provider}${
                        status.ai.model ? ` · ${status.ai.model}` : ""
                      }`
                    : "Not configured"
                }
                detail="Chat, memory-aware replies, and the shared AI provider layer."
              />
              <Capability
                icon="globe"
                title="Research"
                ok={status.search.configured}
                status={
                  status.search.configured
                    ? `${status.search.provider} · live sources`
                    : "No search provider"
                }
                detail="Server-side search plus citation-checked synthesis. Only the question leaves BDM."
              />
              <Capability
                icon="mic"
                title="Voice notes"
                ok={status.voice.configured}
                status={
                  status.voice.configured
                    ? `${status.voice.provider} · ${status.voice.maxDurationSeconds}s max`
                    : "Transcription unavailable"
                }
                detail="Audio is held in memory for the request only; nothing is stored by BDM."
              />
              <Capability
                icon="image"
                title="Images"
                ok={status.images.configured}
                status={
                  status.images.configured ? status.images.model || "Ready" : "Not configured"
                }
                detail="Image generation is optional and uses the existing provider configuration."
              />
              <Capability
                icon="mail"
                title="Email"
                ok={Boolean(status.email?.configured && status.email?.enabled)}
                status={
                  status.email?.configured && status.email.enabled
                    ? `${status.email.provider ?? "provider"} · opt-in`
                    : "Disabled or incomplete"
                }
                detail="Drafts are reviewed before sending. Sending stays opt-in."
              />
              <Capability
                icon="memory"
                title="Memory & library"
                ok={status.memory.available}
                status={status.memory.available ? "Supabase + RLS" : "Sign in required"}
                detail="Long-term memory and saved items are scoped to your account by row-level security."
              />
            </div>
          ) : (
            <p className="notice warn">Capability status is unavailable right now.</p>
          )}
        </section>

        <section className="settings-section" aria-labelledby="environment-heading">
          <div className="section-head">
            <div>
              <h2 id="environment-heading">Environment</h2>
              <p>
                Variable names and whether a value is present. Values are never
                read into this page, never shown, and never logged.
              </p>
            </div>
            {missingRequired.length > 0 ? (
              <span className="status-pill warn">
                {missingRequired.length} required missing
              </span>
            ) : (
              <span className="status-pill ok">Required variables present</span>
            )}
          </div>

          {loading ? (
            <div className="skeleton-block" />
          ) : groupedEnvironment.length === 0 ? (
            <p className="notice warn">
              Environment diagnostics are not available on this server.
            </p>
          ) : (
            <div className="settings-list">
              {groupedEnvironment.map((group) => (
                <div key={group.group}>
                  <div className="sidebar-label" style={{ margin: "10px 0 6px" }}>
                    {group.group}
                  </div>
                  <ul className="settings-list">
                    {group.items.map((item) => (
                      <li className="settings-row" key={item.name}>
                        <span className="settings-label">{item.name}</span>
                        <span className="settings-value">
                          <code>{item.purpose}</code>
                        </span>
                        <span className={`chip ${item.present ? "ok" : "muted"}`}>
                          {item.present ? "Present" : "Not set"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {missingOptional.length > 0 ? (
            <p className="hint">
              {missingOptional.length} optional variable
              {missingOptional.length === 1 ? " is" : "s are"} not set. The
              matching feature stays switched off rather than failing at
              request time.
            </p>
          ) : null}
        </section>

        <section className="settings-section" aria-labelledby="privacy-heading">
          <div className="section-head">
            <div>
              <h2 id="privacy-heading">Privacy & retention</h2>
              <p>What leaves the app, and what stays.</p>
            </div>
          </div>
          <div className="privacy-grid">
            <div>
              <Icon name="mic" size={17} />
              <strong>Voice audio</strong>
              <p>Sent only for transcription, then discarded. BDM does not save the recording.</p>
            </div>
            <div>
              <Icon name="globe" size={17} />
              <strong>Research queries</strong>
              <p>
                Only your question is sent to the search provider, never your
                chat history or memories.
              </p>
            </div>
            <div>
              <Icon name="shield" size={17} />
              <strong>Google identity</strong>
              <p>
                Your Google ID token is verified server-side. The app stores a
                link between Google&rsquo;s subject ID and your existing
                Supabase user.
              </p>
            </div>
            <div>
              <Icon name="lock" size={17} />
              <strong>Session</strong>
              <p>
                Supabase auth cookies stay httpOnly and are refreshed by the
                server proxy.
              </p>
            </div>
          </div>
          {status?.quotas && (
            <p className="hint">
              Usage quotas are stored in{" "}
              {status.quotas.store === "database" ? "the database" : "an unconfigured store"}.
              Migration state is not assumed: {status.quotas.migrationState}.
            </p>
          )}
        </section>

        <section className="settings-section" aria-labelledby="data-heading">
          <div className="section-head">
            <div>
              <h2 id="data-heading">Data & backup</h2>
              <p>Export your conversations and memories, or restore from a backup.</p>
            </div>
          </div>
          <div className="data-actions">
            <a className="btn primary" href="/api/conversations/export" download>
              <Icon name="external" size={15} />
              Export data
            </a>
            <label className="btn ghost file-input-label">
              <Icon name="copy" size={15} />
              Import data
              <input
                type="file"
                accept=".json"
                hidden
                onChange={handleImport}
              />
            </label>
          </div>
          {importStatus && (
            <p className={`notice ${importStatus.ok ? "ok" : "error"}`}>
              {importStatus.message}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

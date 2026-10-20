"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "../../../lib/supabase-browser";

/**
 * Password reset completion page.
 *
 * Supabase Auth owns the recovery token. The email link returns here with
 * either a `code` (PKCE) or session tokens in the URL fragment; the browser
 * client exchanges/absorbs it, and the new password is written with
 * `updateUser`. No custom token is created or accepted by this app.
 */
export default function ResetPage() {
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();

        const code = new URLSearchParams(window.location.search).get("code");
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        }

        let session = (await supabase.auth.getSession()).data.session;
        if (!session && window.location.hash.includes("access_token")) {
          // detectSessionInUrl may still be finishing its own exchange.
          await new Promise((resolve) => setTimeout(resolve, 700));
          session = (await supabase.auth.getSession()).data.session;
        }

        if (!cancelled) setReady(Boolean(session));
      } catch {
        if (!cancelled) setReady(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      await supabase.auth.signOut();
      setDone(true);
    } catch {
      setError("The password could not be updated. Request a new reset link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.main}>
      <div style={styles.card}>
        <h1 style={styles.title}>BDM</h1>
        <p style={styles.subtitle}>Set a new password</p>

        {checking && <p style={styles.muted}>Checking your reset link…</p>}

        {!checking && !ready && !done && (
          <>
            <div style={styles.error}>
              This reset link is invalid or has expired.
            </div>
            <Link style={styles.link} href="/auth">
              Request a new reset link
            </Link>
          </>
        )}

        {!checking && ready && !done && (
          <form onSubmit={submit} style={styles.form}>
            <label style={styles.label}>
              New password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                style={styles.input}
              />
            </label>
            <label style={styles.label}>
              Confirm new password
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                style={styles.input}
              />
            </label>

            {error && <div style={styles.error}>{error}</div>}

            <button type="submit" disabled={busy} style={styles.submit}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}

        {done && (
          <>
            <div style={styles.notice}>
              Password updated. Sign in with your new password.
            </div>
            <Link style={styles.link} href="/auth">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0b0d12",
    color: "#e6e8ee",
    fontFamily: "system-ui, sans-serif",
    padding: 24
  },
  card: {
    width: "100%",
    maxWidth: 380,
    background: "#14171f",
    border: "1px solid #262b36",
    borderRadius: 14,
    padding: 28
  },
  title: { margin: 0, fontSize: 28, letterSpacing: 1 },
  subtitle: { margin: "6px 0 20px", color: "#9aa3b2", fontSize: 14 },
  muted: { color: "#9aa3b2", fontSize: 14 },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#9aa3b2" },
  input: {
    padding: "10px 12px",
    background: "#0e1117",
    border: "1px solid #2a303c",
    borderRadius: 8,
    color: "#e6e8ee",
    fontSize: 14
  },
  error: {
    background: "#3a1d1d",
    border: "1px solid #6b2b2b",
    color: "#ffb4b4",
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: 13
  },
  notice: {
    background: "#1d3a2a",
    border: "1px solid #2b6b45",
    color: "#b4ffcf",
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: 13
  },
  submit: {
    marginTop: 6,
    padding: "11px 0",
    background: "#3b6cff",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    cursor: "pointer"
  },
  link: { color: "#a9b6ff", fontSize: 13, marginTop: 12, display: "inline-block" }
};

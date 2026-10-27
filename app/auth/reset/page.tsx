"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandLogo from "../../components/BrandLogo";
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
    <main className="auth-page auth-page-single">
      <section className="auth-card" aria-label="Set a new password">
        <div className="auth-card-head">
          <BrandLogo variant="full" size={34} className="auth-logo" decorative />
          <h1 className="auth-title">Set a new password</h1>
          <p className="auth-sub">Choose a new password for your BDM account.</p>
        </div>

        {checking ? <p className="hint">Checking your reset link…</p> : null}

        {!checking && !ready && !done ? (
          <>
            <p className="notice error" role="alert">
              This reset link is invalid or has expired.
            </p>
            <Link className="auth-link" href="/auth">
              Request a new reset link
            </Link>
          </>
        ) : null}

        {!checking && ready && !done ? (
          <form onSubmit={submit} className="auth-form">
            <label className="auth-label" htmlFor="reset-password">
              New password
            </label>
            <input
              id="reset-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="auth-input"
            />

            <label className="auth-label" htmlFor="reset-confirm">
              Confirm new password
            </label>
            <input
              id="reset-confirm"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="auth-input"
            />

            {error ? (
              <p className="notice error" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn primary auth-submit" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        ) : null}

        {done ? (
          <>
            <p className="notice ok">Password updated. Sign in with your new password.</p>
            <Link className="auth-link" href="/auth">
              Go to sign in
            </Link>
          </>
        ) : null}
      </section>
    </main>
  );
}

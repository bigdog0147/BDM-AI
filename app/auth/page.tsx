"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon, GoogleIcon } from "../components/Icons";
import BrandLogo from "../components/BrandLogo";

type Mode = "signin" | "signup" | "forgot";

const GOOGLE_ERRORS: Record<string, string> = {
  google_not_configured:
    "Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.",
  google_store_not_configured:
    "The Google identity guard is unavailable. Add SUPABASE_SERVICE_ROLE_KEY and apply the 0004 Google identities migration.",
  google_account_exists:
    "An account with that email already exists. Sign in with your password first, then connect Google from Settings. BDM never links by email alone.",
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
  google_sign_in_required: "Sign in to BDM first, then connect Google from Settings.",
  auth_not_configured: "Supabase Auth is not configured on this server.",
  google_redirect_uri:
    "The Google redirect URI is invalid. Use HTTPS, or localhost during development."
};

const TABS = [
  { key: "signin" as Mode, label: "Sign in", description: "Welcome back" },
  { key: "signup" as Mode, label: "Sign up", description: "Create an account" }
] as const;

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    const urlNotice = params.get("notice");
    const urlMode = params.get("mode");

    if (urlError) {
      setTimeout(
        () => setError(GOOGLE_ERRORS[urlError] ?? "Authentication could not complete."),
        0
      );
    }
    if (urlNotice) {
      setTimeout(() => setNotice(urlNotice), 0);
    }
    if (urlMode === "forgot") {
      setTimeout(() => setMode("forgot"), 0);
    }
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setEmail("");
    setPassword("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      setError("A valid email is required.");
      return;
    }

    if (mode !== "forgot" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);

    try {
      let endpoint = `/api/auth/${mode === "signup" ? "signup" : "signin"}`;
      let body = JSON.stringify({ email: trimmedEmail, password });

      if (mode === "forgot") {
        endpoint = "/api/auth/resend-verification";
        body = JSON.stringify({ email: trimmedEmail });
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      });

      const data = (await response.json()) as { error?: string; ok?: boolean };

      if (!response.ok) {
        throw new Error(data.error || "Authentication failed.");
      }

      if (mode === "forgot") {
        setNotice(
          "If an account exists for that email, a verification link has been sent."
        );
        setEmail("");
      } else if (mode === "signup") {
        setNotice(
          "Account created. Check your email for the confirmation link, then sign in."
        );
        setMode("signin");
        setEmail("");
        setPassword("");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  const currentTab = TABS.find((t) => t.key === mode) ?? TABS[0];

  return (
    <main className="auth-page">
      <section className="auth-showcase" aria-label="About BDM">
        <BrandLogo variant="mark" size={44} decorative />
        <h1 className="auth-showcase-title">
          Your personal AI, working from one quiet workspace.
        </h1>
        <p className="auth-showcase-text">
          Chat with BDM, speak a note and have it transcribed, or send a
          question to the live web and get an answer with the sources attached.
          Everything is scoped to your own account.
        </p>
        <ul className="auth-points">
          <li>
            <Icon name="shield" size={15} />
            Server-verified Google sign-in. BDM never links an account by
            email alone.
          </li>
          <li>
            <Icon name="mic" size={15} />
            Voice notes are transcribed and then discarded. Nothing is kept.
          </li>
          <li>
            <Icon name="globe" size={15} />
            Research answers carry the sources behind every claim.
          </li>
        </ul>
      </section>

      <div className="auth-card">
        <header className="auth-card-head">
          <span className="auth-logo">
            <BrandLogo variant="mark" size={34} decorative />
          </span>
          <h1 className="auth-title">{currentTab.label}</h1>
          <p className="auth-sub">{currentTab.description}</p>
        </header>

        {mode !== "forgot" ? (
          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={mode === tab.key}
                className={`auth-tab${mode === tab.key ? " active" : ""}`}
                onClick={() => switchMode(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        {notice && (
          <div className="notice ok" role="status">
            {notice}
          </div>
        )}

        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}

        <div className="google-form">
          <a
            className={`google-btn${busy ? " disabled" : ""}`}
            href="/api/auth/google/start"
            aria-disabled={busy}
          >
            <GoogleIcon size={18} />
            Continue with Google
          </a>
          <p className="hint google-hint">
            Google verifies your email on the server before BDM creates an
            account.
          </p>
        </div>

        <div className="auth-divider">
          <span>or use email and password</span>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              disabled={busy}
              required
            />
          </div>

          {mode !== "forgot" && (
            <div className="auth-field">
              <div className="auth-password-row">
                <label className="auth-label" htmlFor="password">
                  Password
                </label>
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="password"
                className="auth-input"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  mode === "signin" ? "Your password" : "At least 8 characters"
                }
                disabled={busy}
                required
              />
            </div>
          )}

          <button type="submit" className="btn primary auth-submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "forgot"
                ? "Send email"
                : currentTab.label}
          </button>
        </form>

        <div className="auth-links">
          {mode !== "forgot" && (
            <button
              type="button"
              className="auth-link"
              onClick={() => switchMode("forgot")}
            >
              {mode === "signin"
                ? "Forgot password?"
                : "Didn't receive the verification email?"}
            </button>
          )}
          {mode === "forgot" && (
            <button
              type="button"
              className="auth-link"
              onClick={() => switchMode("signin")}
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

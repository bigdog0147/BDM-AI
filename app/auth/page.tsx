"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Sign-in / sign-up page. Talks to the /api/auth/* routes which use the
 * server-side Supabase SSR client; on success the auth cookie is set and we
 * return to the chat.
 */
export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = (await res.json()) as { error?: string; needsConfirmation?: boolean };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      if (mode === "signup" && data.needsConfirmation) {
        setNotice("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.main}>
      <div style={styles.card}>
        <h1 style={styles.title}>BDM</h1>
        <p style={styles.subtitle}>
          {mode === "signin" ? "Sign in to your assistant" : "Create your account"}
        </p>

        <div style={styles.tabs}>
          <button
            type="button"
            onClick={() => setMode("signin")}
            style={{ ...styles.tab, ...(mode === "signin" ? styles.tabActive : {}) }}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            style={{ ...styles.tab, ...(mode === "signup" ? styles.tabActive : {}) }}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={submit} style={styles.form}>
          <label style={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              style={styles.input}
            />
          </label>

          {error && <div style={styles.error}>{error}</div>}
          {notice && <div style={styles.notice}>{notice}</div>}

          <button type="submit" disabled={busy} style={styles.submit}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
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
  tabs: { display: "flex", gap: 8, marginBottom: 18 },
  tab: {
    flex: 1,
    padding: "8px 0",
    background: "transparent",
    color: "#9aa3b2",
    border: "1px solid #2a303c",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14
  },
  tabActive: { background: "#1d2330", color: "#e6e8ee", borderColor: "#3a4252" },
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
  }
};

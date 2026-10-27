/**
 * Presentation helpers for the workspace UI.
 *
 * Kept out of the React tree so the behaviour (greeting, name derivation,
 * relative timestamps) can be unit tested without a browser.
 */

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

export function greetingFor(date: Date = new Date()): Greeting {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * A friendly name from the signed-in email address.
 *
 * This is derived from the real account, never hard-coded, and it is only
 * ever used as a greeting - the full address stays visible in the sidebar so
 * the user always knows which account is active.
 */
export function displayNameFromEmail(email?: string | null): string | null {
  if (!email) return null;
  const local = email.split("@")[0]?.trim();
  if (!local) return null;
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function initialsFromEmail(email?: string | null): string {
  const name = displayNameFromEmail(email);
  if (!name) return "YOU";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short, honest timestamps for the history list. */
export function formatRelativeTime(
  iso?: string | null,
  now: Date = new Date()
): string {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";

  const diff = now.getTime() - time;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return "Yesterday";

  const date = new Date(time);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric"
  });
}

export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

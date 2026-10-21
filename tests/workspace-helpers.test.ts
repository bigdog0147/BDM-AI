import { describe, expect, it } from "vitest";
import {
  displayNameFromEmail,
  formatElapsed,
  formatRelativeTime,
  greetingFor,
  initialsFromEmail
} from "../lib/workspace";

/**
 * Workspace presentation helpers.
 *
 * The greeting and the display name are derived from the real signed-in
 * account, never from a hard-coded person.
 */

describe("greeting", () => {
  it("follows the time of day", () => {
    expect(greetingFor(new Date("2026-10-20T08:15:00"))).toBe("Good morning");
    expect(greetingFor(new Date("2026-10-20T14:15:00"))).toBe("Good afternoon");
    expect(greetingFor(new Date("2026-10-20T21:15:00"))).toBe("Good evening");
  });
});

describe("display name", () => {
  it("derives a name from the real email address", () => {
    expect(displayNameFromEmail("ada.lovelace@example.com")).toBe("Ada Lovelace");
    expect(displayNameFromEmail("grace_hopper@example.com")).toBe("Grace Hopper");
  });

  it("returns null when there is no account", () => {
    expect(displayNameFromEmail(null)).toBeNull();
    expect(displayNameFromEmail("")).toBeNull();
  });

  it("builds initials for the avatar", () => {
    expect(initialsFromEmail("ada.lovelace@example.com")).toBe("AL");
    expect(initialsFromEmail("ada@example.com")).toBe("AD");
    expect(initialsFromEmail(null)).toBe("YOU");
  });
});

describe("relative time", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  it("describes recent activity", () => {
    expect(formatRelativeTime("2026-10-20T11:59:30Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-10-20T11:45:00Z", now)).toBe("15m ago");
    expect(formatRelativeTime("2026-10-20T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-10-19T09:00:00Z", now)).toBe("Yesterday");
  });

  it("never throws on a missing or invalid timestamp", () => {
    expect(formatRelativeTime(null, now)).toBe("");
    expect(formatRelativeTime("not-a-date", now)).toBe("");
  });
});

describe("elapsed time", () => {
  it("formats a recording timer", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9)).toBe("0:09");
    expect(formatElapsed(75)).toBe("1:15");
    expect(formatElapsed(600)).toBe("10:00");
  });
});

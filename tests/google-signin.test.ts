import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  completeGoogleSignIn,
  GoogleSignInFailure,
} from "../lib/google-signin";
import type {
  GoogleIdentity,
  GoogleMode,
} from "../lib/google-auth";
import type {
  StoreResult,
  CreateGoogleUserResult,
  GoogleLink,
} from "../lib/google-identity-store";

const TEST_IDENTITY: GoogleIdentity = {
  sub: "google-sub-123",
  email: "test@example.com",
  emailVerified: true,
  name: "Test User",
  picture: "https://example.com/photo.jpg",
  issuer: "https://accounts.google.com",
  audience: "test-client-id",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};

const TEST_USER = { id: "user-456", email: "test@example.com", providers: ["email"] };

function createDeps(overrides: Partial<{
  identity: GoogleIdentity;
  mode: GoogleMode;
  currentUser: { id: string; email?: string | null } | null;
  findLink: (googleSub: string) => Promise<StoreResult<GoogleLink | null>>;
  findUserLink: (userId: string) => Promise<StoreResult<GoogleLink | null>>;
  createUser: (input: { email: string; name: string | null; picture: string | null }) => Promise<CreateGoogleUserResult>;
  createLink: (input: { googleSub: string; userId: string; email: string }) => Promise<StoreResult<GoogleLink>>;
  touchLink: (googleSub: string) => Promise<void>;
  deleteLink: (googleSub: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  signInWithIdToken: () => Promise<{ userId: string }>;
  signOut: () => Promise<void>;
}> = {}) {
  return {
    identity: TEST_IDENTITY,
    mode: "signin" as GoogleMode,
    currentUser: null,
    findLink: vi.fn().mockResolvedValue({ ok: true, value: null }),
    findUserLink: vi.fn().mockResolvedValue({ ok: true, value: null }),
    createUser: vi.fn().mockResolvedValue({ ok: true, userId: "new-user-789" }),
    createLink: vi.fn().mockResolvedValue({ ok: true, value: { googleSub: TEST_IDENTITY.sub, userId: "new-user-789", email: TEST_IDENTITY.email } }),
    touchLink: vi.fn().mockResolvedValue(undefined),
    deleteLink: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    signInWithIdToken: vi.fn().mockResolvedValue({ userId: "new-user-789" }),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("google-signin: account linking policy", () => {
  describe("signin mode (new user)", () => {
    it("creates user and link when no existing link", async () => {
      const deps = createDeps();
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.userId).toBe("new-user-789");
        expect(result.mode).toBe("signin");
      }
      expect(deps.createUser).toHaveBeenCalledWith({
        email: TEST_IDENTITY.email,
        name: TEST_IDENTITY.name,
        picture: TEST_IDENTITY.picture,
      });
      expect(deps.createLink).toHaveBeenCalled();
      expect(deps.signInWithIdToken).toHaveBeenCalled();
    });

    it("refuses when email exists with password (account_exists)", async () => {
      const deps = createDeps({
        createUser: vi.fn().mockResolvedValue({ ok: false, reason: "exists" }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("account_exists");
    });

    it("fails when store unavailable", async () => {
      const deps = createDeps({
        findLink: vi.fn().mockResolvedValue({ ok: false, reason: "not_configured" }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("store_unavailable");
    });

    it("fails when user creation fails", async () => {
      const deps = createDeps({
        createUser: vi.fn().mockResolvedValue({ ok: false, reason: "failed" }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("account_create_failed");
    });

    it("fails when link creation fails", async () => {
      const deps = createDeps({
        createLink: vi.fn().mockResolvedValue({ ok: false, reason: "failed" }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("link_failed");
    });

    it("rolls back link and user when signInWithIdToken fails", async () => {
      const deps = createDeps({
        signInWithIdToken: vi.fn().mockResolvedValue(null),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("sign_in_failed");
      expect(deps.deleteLink).toHaveBeenCalledWith(TEST_IDENTITY.sub);
      expect(deps.deleteUser).toHaveBeenCalledWith("new-user-789");
    });

    it("fails when returned user ID mismatches created user", async () => {
      const deps = createDeps({
        signInWithIdToken: vi.fn().mockResolvedValue({ userId: "different-user" }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("user_mismatch");
    });
  });

  describe("signin mode (returning Google user)", () => {
    it("signs in existing linked user", async () => {
      const deps = createDeps({
        findLink: vi.fn().mockResolvedValue({
          ok: true,
          value: { googleSub: TEST_IDENTITY.sub, userId: "existing-user", email: TEST_IDENTITY.email },
        }),
        signInWithIdToken: vi.fn().mockResolvedValue({ userId: "existing-user" }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.userId).toBe("existing-user");
        expect(result.mode).toBe("signin");
      }
      expect(deps.signInWithIdToken).toHaveBeenCalled();
      expect(deps.touchLink).toHaveBeenCalledWith(TEST_IDENTITY.sub);
    });

    it("fails when returned user ID mismatches linked user", async () => {
      const deps = createDeps({
        findLink: vi.fn().mockResolvedValue({
          ok: true,
          value: { googleSub: TEST_IDENTITY.sub, userId: "existing-user", email: TEST_IDENTITY.email },
        }),
        signInWithIdToken: vi.fn().mockResolvedValue({ userId: "different-user" }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("user_mismatch");
    });
  });

  describe("link mode (signed-in user linking Google)", () => {
    it("links Google to current user when email matches", async () => {
      const deps = createDeps({
        mode: "link",
        currentUser: TEST_USER,
        findLink: vi.fn().mockResolvedValue({ ok: true, value: null }),
        findUserLink: vi.fn().mockResolvedValue({ ok: true, value: null }),
        signInWithIdToken: vi.fn().mockResolvedValue({ userId: TEST_USER.id }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.userId).toBe(TEST_USER.id);
        expect(result.mode).toBe("link");
      }
      expect(deps.createLink).toHaveBeenCalledWith({
        googleSub: TEST_IDENTITY.sub,
        userId: TEST_USER.id,
        email: TEST_IDENTITY.email,
      });
      expect(deps.signInWithIdToken).toHaveBeenCalled();
    });

    it("refuses when not authenticated", async () => {
      const deps = createDeps({
        mode: "link",
        currentUser: null,
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("not_authenticated");
    });

    it("refuses when Google email differs from user email", async () => {
      const deps = createDeps({
        mode: "link",
        currentUser: { id: "user-456", email: "other@example.com" },
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("email_mismatch");
    });

    it("refuses when Google account already linked to different user", async () => {
      const deps = createDeps({
        mode: "link",
        currentUser: TEST_USER,
        findLink: vi.fn().mockResolvedValue({
          ok: true,
          value: { googleSub: TEST_IDENTITY.sub, userId: "other-user", email: TEST_IDENTITY.email },
        }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("already_linked");
    });

    it("refuses when user already has different Google account linked", async () => {
      const deps = createDeps({
        mode: "link",
        currentUser: TEST_USER,
        findLink: vi.fn().mockResolvedValue({ ok: true, value: null }),
        findUserLink: vi.fn().mockResolvedValue({
          ok: true,
          value: { googleSub: "other-google-sub", userId: TEST_USER.id, email: "other@example.com" },
        }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("already_linked");
    });

    it("rolls back link when signInWithIdToken fails", async () => {
      const deps = createDeps({
        mode: "link",
        currentUser: TEST_USER,
        findLink: vi.fn().mockResolvedValue({ ok: true, value: null }),
        findUserLink: vi.fn().mockResolvedValue({ ok: true, value: null }),
        signInWithIdToken: vi.fn().mockResolvedValue(null),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("sign_in_failed");
      expect(deps.deleteLink).toHaveBeenCalledWith(TEST_IDENTITY.sub);
    });

    it("fails when returned user ID mismatches current user", async () => {
      const deps = createDeps({
        mode: "link",
        currentUser: TEST_USER,
        findLink: vi.fn().mockResolvedValue({ ok: true, value: null }),
        findUserLink: vi.fn().mockResolvedValue({ ok: true, value: null }),
        signInWithIdToken: vi.fn().mockResolvedValue({ userId: "different-user" }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("user_mismatch");
    });
  });

  describe("email comparison", () => {
    it("matches emails case-insensitively", async () => {
      const identity = { ...TEST_IDENTITY, email: "Test@Example.COM" };
      const deps = createDeps({
        mode: "link",
        currentUser: { id: "user-456", email: "test@example.com" },
        identity,
        signInWithIdToken: vi.fn().mockResolvedValue({ userId: "user-456" }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(true);
    });

    it("trims whitespace before comparing", async () => {
      const identity = { ...TEST_IDENTITY, email: "  test@example.com  " };
      const deps = createDeps({
        mode: "link",
        currentUser: { id: "user-456", email: "test@example.com" },
        identity,
        signInWithIdToken: vi.fn().mockResolvedValue({ userId: "user-456" }),
      });
      const result = await completeGoogleSignIn(deps);
      expect(result.ok).toBe(true);
    });
  });
});
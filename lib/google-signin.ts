import type { GoogleIdentity, GoogleMode } from "./google-auth";
import type {
  CreateGoogleUserResult,
  GoogleLink,
  StoreResult
} from "./google-identity-store";

/**
 * The account-linking policy, kept pure and injectable so it can be tested
 * without Google, Supabase, or a network.
 *
 * Rule: a Google email that matches an existing Supabase account is never
 * linked implicitly. A first-time Google user is created explicitly; an
 * existing account can only gain a Google link while signed in and proving
 * the same verified email (`mode: "link"`).
 */

export type GoogleSignInFailure =
  | "not_authenticated"
  | "email_mismatch"
  | "already_linked"
  | "account_exists"
  | "store_unavailable"
  | "account_create_failed"
  | "link_failed"
  | "sign_in_failed"
  | "user_mismatch";

export type GoogleSignInResult =
  | { ok: true; userId: string; mode: GoogleMode }
  | { ok: false; reason: GoogleSignInFailure };

export interface GoogleSignInDeps {
  identity: GoogleIdentity;
  mode: GoogleMode;
  currentUser: { id: string; email?: string | null } | null;
  findLink: (googleSub: string) => Promise<StoreResult<GoogleLink | null>>;
  findUserLink: (userId: string) => Promise<StoreResult<GoogleLink | null>>;
  createUser: (input: {
    email: string;
    name: string | null;
    picture: string | null;
  }) => Promise<CreateGoogleUserResult>;
  createLink: (input: {
    googleSub: string;
    userId: string;
    email: string;
  }) => Promise<StoreResult<GoogleLink>>;
  touchLink: (googleSub: string) => Promise<void>;
  deleteLink: (googleSub: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  signInWithIdToken: () => Promise<{ userId: string }>;
  signOut: () => Promise<void>;
}

function fail(reason: GoogleSignInFailure): GoogleSignInResult {
  return { ok: false, reason };
}

function sameEmail(a: string | null | undefined, b: string): boolean {
  return typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function attemptSignIn(
  deps: GoogleSignInDeps
): Promise<{ userId: string } | null> {
  try {
    const result = await deps.signInWithIdToken();
    return result?.userId ? result : null;
  } catch {
    return null;
  }
}

export async function completeGoogleSignIn(
  deps: GoogleSignInDeps
): Promise<GoogleSignInResult> {
  const { identity } = deps;
  const email = identity.email.trim().toLowerCase();

  if (deps.mode === "link") {
    if (!deps.currentUser) return fail("not_authenticated");
    if (!sameEmail(deps.currentUser.email, email)) return fail("email_mismatch");

    const bySub = await deps.findLink(identity.sub);
    if (!bySub.ok) return fail("store_unavailable");
    if (bySub.value && bySub.value.userId !== deps.currentUser.id) {
      return fail("already_linked");
    }

    const byUser = await deps.findUserLink(deps.currentUser.id);
    if (!byUser.ok) return fail("store_unavailable");
    if (byUser.value && byUser.value.googleSub !== identity.sub) {
      return fail("already_linked");
    }

    let created = false;
    if (!bySub.value) {
      const link = await deps.createLink({
        googleSub: identity.sub,
        userId: deps.currentUser.id,
        email
      });
      if (!link.ok) {
        return fail(link.reason === "not_configured" ? "store_unavailable" : "link_failed");
      }
      created = true;
    }

    const session = await attemptSignIn(deps);
    if (!session) {
      if (created) await deps.deleteLink(identity.sub);
      return fail("sign_in_failed");
    }
    if (session.userId !== deps.currentUser.id) {
      if (created) await deps.deleteLink(identity.sub);
      await deps.signOut();
      return fail("user_mismatch");
    }

    await deps.touchLink(identity.sub);
    return { ok: true, userId: deps.currentUser.id, mode: "link" };
  }

  const existing = await deps.findLink(identity.sub);
  if (!existing.ok) return fail("store_unavailable");

  if (existing.value) {
    const session = await attemptSignIn(deps);
    if (!session) return fail("sign_in_failed");
    if (session.userId !== existing.value.userId) {
      await deps.signOut();
      return fail("user_mismatch");
    }
    await deps.touchLink(identity.sub);
    return { ok: true, userId: existing.value.userId, mode: "signin" };
  }

  const createdUser = await deps.createUser({
    email,
    name: identity.name,
    picture: identity.picture
  });
  if (!createdUser.ok) {
    if (createdUser.reason === "exists") return fail("account_exists");
    return fail(
      createdUser.reason === "not_configured"
        ? "store_unavailable"
        : "account_create_failed"
    );
  }

  const link = await deps.createLink({
    googleSub: identity.sub,
    userId: createdUser.userId,
    email
  });
  if (!link.ok) {
    await deps.deleteUser(createdUser.userId);
    return fail(link.reason === "not_configured" ? "store_unavailable" : "link_failed");
  }

  const session = await attemptSignIn(deps);
  if (!session) {
    await deps.deleteLink(identity.sub);
    await deps.deleteUser(createdUser.userId);
    return fail("sign_in_failed");
  }
  if (session.userId !== createdUser.userId) {
    await deps.deleteLink(identity.sub);
    await deps.signOut();
    await deps.deleteUser(createdUser.userId);
    return fail("user_mismatch");
  }

  await deps.touchLink(identity.sub);
  return { ok: true, userId: createdUser.userId, mode: "signin" };
}

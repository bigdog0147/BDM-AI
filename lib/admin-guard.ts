import { currentUser, type AuthUser } from "./auth";

export interface AdminAccessVerdict {
  ok: boolean;
  user: AuthUser | null;
  isDev: boolean;
  role: "superadmin" | "admin" | "developer" | "none";
  reason?: string;
}

export function isLoopbackAddress(host?: string | null): boolean {
  if (!host) return false;
  const clean = host.split(":")[0]?.toLowerCase();
  return (
    clean === "localhost" ||
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean === "0.0.0.0"
  );
}

/**
 * Validates if the requesting session or context has Administrative privileges.
 */
export async function getAdminAccess(request?: Request): Promise<AdminAccessVerdict> {
  const isDev = process.env.NODE_ENV !== "production";
  const user = await currentUser();

  // Check custom passcode header/cookie for emergency admin access
  if (request) {
    const passcodeHeader = request.headers.get("x-admin-passcode");
    const configuredPasscode = process.env.ADMIN_PASSCODE?.trim();
    if (configuredPasscode && passcodeHeader === configuredPasscode) {
      return {
        ok: true,
        user,
        isDev,
        role: "superadmin"
      };
    }
  }

  // Development environment or local loopback access
  if (isDev) {
    return {
      ok: true,
      user,
      isDev: true,
      role: "developer"
    };
  }

  const host = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host");
  if (isLoopbackAddress(host)) {
    return {
      ok: true,
      user,
      isDev: true,
      role: "developer"
    };
  }

  if (!user || !user.email) {
    return {
      ok: false,
      user: null,
      isDev: false,
      role: "none",
      reason: "Authentication required to access BDM Administration."
    };
  }

  const adminEmails = [
    process.env.ADMIN_EMAIL,
    process.env.OWNER_EMAIL,
    process.env.NEXT_PUBLIC_ADMIN_EMAIL
  ]
    .filter(Boolean)
    .flatMap((val) => (val ? val.split(",") : []))
    .map((e) => e.trim().toLowerCase());

  const userEmail = user.email.toLowerCase();

  // If specific admin emails are defined, enforce membership
  if (adminEmails.length > 0) {
    if (adminEmails.includes(userEmail)) {
      return {
        ok: true,
        user,
        isDev: false,
        role: "superadmin"
      };
    }
    return {
      ok: false,
      user,
      isDev: false,
      role: "none",
      reason: `Account ${user.email} is not authorized for administrative access.`
    };
  }

  // Fallback: If no explicit ADMIN_EMAIL list is set, any authenticated user is treated as admin in single-tenant personal AI mode
  return {
    ok: true,
    user,
    isDev: false,
    role: "admin"
  };
}

/**
 * Workspace Boundary Enforcement.
 *
 * Ensures all filesystem operations stay within authorized roots.
 * Prevents path traversal and unauthorized access.
 */

import path from "path";
import { createSupabaseServerClient } from "./supabase-server";

export interface WorkspaceRoot {
  id: string;
  user_id: string;
  name: string;
  path: string;              // Absolute path on the server
  description?: string;
  created_at: string;
}

function runtimeProjectRoot(): string {
  const cwdFn = process["cwd" as keyof NodeJS.Process] as () => string;
  return typeof cwdFn === "function" ? cwdFn.call(process) : ".";
}

function getDefaultRoots(): string[] {
  return [
    runtimeProjectRoot(),
    process.env.HOME ?? "",
    process.env.USERPROFILE ?? ""
  ].filter(Boolean);
}

/**
 * Get the user's configured workspace roots from the database.
 * Falls back to defaults if none configured.
 */
export async function getWorkspaceRoots(userId: string): Promise<string[]> {
  const defaults = getDefaultRoots();
  if (!isConfigured()) return defaults;

  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from("bdm_workspace_roots")
      .select("path")
      .eq("user_id", userId)
      .eq("active", true);

    if (error || !data || data.length === 0) {
      return defaults;
    }

    return data.map((r) => r.path);
  } catch {
    return defaults;
  }
}

/**
 * Normalize and resolve a path, preventing traversal.
 * Returns the resolved absolute path if it's within an allowed root.
 */
export function resolveWithinRoots(
  requestedPath: string,
  roots: string[]
): { ok: true; path: string } | { ok: false; reason: string } {
  // Normalize: resolve . and .., remove trailing separators
  let normalized: string;
  try {
    normalized = path.resolve(requestedPath);
  } catch {
    return { ok: false, reason: "Invalid path" };
  }

  // Check against each root
  for (const root of roots) {
    const rootResolved = path.resolve(root);
    // Ensure the requested path starts with the root
    if (normalized.startsWith(rootResolved + path.sep) || normalized === rootResolved) {
      return { ok: true, path: normalized };
    }
  }

  return { ok: false, reason: `Path outside authorized workspace roots: ${normalized}` };
}

/**
 * High-level check: can the user access this path?
 * Combines workspace root check with any future per-path ACLs.
 */
export async function canAccessPath(
  userId: string,
  requestedPath: string
): Promise<{ allowed: boolean; reason?: string; resolvedPath?: string }> {
  const roots = await getWorkspaceRoots(userId);
  const result = resolveWithinRoots(requestedPath, roots);
  if (!result.ok) {
    return { allowed: false, reason: result.reason };
  }
  return { allowed: true, resolvedPath: result.path };
}

/**
 * Check if a path is within the project directory (for project-scoped operations).
 */
export function isWithinProject(requestedPath: string): boolean {
  const projectRoot = path.normalize(runtimeProjectRoot());
  const normalized = path.resolve(requestedPath);
  return normalized.startsWith(projectRoot + path.sep) || normalized === projectRoot;
}

// --- Internal helpers ---

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

async function getClient() {
  return createSupabaseServerClient();
}
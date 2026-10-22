import { createSupabaseServerClient } from "./supabase-server";
import { getCapabilities, getOperationDefaultPermission } from "./capabilities";

/**
 * Permission enforcement for tools and capabilities.
 *
 * Integrates with the existing `bdm_tool_permissions` table (created in 0001_bdm_foundation.sql).
 * Every tool call checks the user's permission level before execution.
 * Defaults are derived from the capability registry.
 */

export type PermissionLevel = "deny" | "ask" | "allow";

export interface ToolPermission {
  tool_key: string;
  permission_level: PermissionLevel;
  updated_at: string;
}

/**
 * Build default permissions from the capability registry.
 * This ensures the permission defaults stay in sync with capability definitions.
 */
function buildDefaultPermissions(): Record<string, PermissionLevel> {
  const defaults: Record<string, PermissionLevel> = {};
  for (const cap of getCapabilities()) {
    for (const op of cap.operations) {
      defaults[op.permissionKey] = getOperationDefaultPermission(cap.key, op.name);
    }
  }
  // Add any legacy keys not covered by capabilities
  return {
    ...defaults,
    "memory.save": "ask",
    "memory.update": "ask",
    "memory.delete": "ask",
    "webhook.send": "ask",
    "secret.rotate": "deny",
    "database.migrate": "deny",
    "user.delete": "deny",
    "financial.transfer": "deny"
  };
}

const DEFAULT_PERMISSIONS = buildDefaultPermissions();

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

async function getClient() {
  return createSupabaseServerClient();
}

/**
 * Get the effective permission level for a tool.
 * Checks user-specific setting, falls back to default, then "deny".
 */
export async function getToolPermission(
  userId: string,
  toolKey: string
): Promise<PermissionLevel> {
  if (!isConfigured()) return DEFAULT_PERMISSIONS[toolKey] ?? "deny";

  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from("bdm_tool_permissions")
      .select("permission_level")
      .eq("user_id", userId)
      .eq("tool_key", toolKey)
      .single();

    if (error || !data) {
      return DEFAULT_PERMISSIONS[toolKey] ?? "deny";
    }

    return data.permission_level as PermissionLevel;
  } catch {
    return DEFAULT_PERMISSIONS[toolKey] ?? "deny";
  }
}

/**
 * Get all tool permissions for a user (for settings UI).
 */
export async function listToolPermissions(userId: string): Promise<ToolPermission[]> {
  if (!isConfigured()) return [];

  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from("bdm_tool_permissions")
      .select("*")
      .eq("user_id", userId)
      .order("tool_key", { ascending: true });

    if (error || !data) return [];
    return data as ToolPermission[];
  } catch {
    return [];
  }
}

/**
 * Set a tool permission for a user.
 */
export async function setToolPermission(
  userId: string,
  toolKey: string,
  level: PermissionLevel
): Promise<boolean> {
  if (!isConfigured()) return false;

  try {
    const supabase = await getClient();
    const { error } = await supabase
      .from("bdm_tool_permissions")
      .upsert({
        user_id: userId,
        tool_key: toolKey,
        permission_level: level,
        updated_at: new Date().toISOString()
      });

    return !error;
  } catch {
    return false;
  }
}

/**
 * Check if a tool call is permitted.
 * Returns { allowed: true } | { allowed: false; reason: "denied" | "requires_approval" }
 */
export async function checkPermission(
  userId: string,
  toolKey: string
): Promise<{ allowed: true } | { allowed: false; reason: "denied" | "requires_approval" }> {
  const level = await getToolPermission(userId, toolKey);

  if (level === "deny") return { allowed: false, reason: "denied" };
  if (level === "ask") return { allowed: false, reason: "requires_approval" };
  return { allowed: true };
}

/**
 * Tool categories for UI grouping.
 */
export const TOOL_CATEGORIES: Record<string, { label: string; tools: string[] }> = {
  search: {
    label: "Web Search",
    tools: ["search.web", "search.tavily", "search.brave", "search.searxng"]
  },
  filesystem: {
    label: "Filesystem",
    tools: ["filesystem.read", "filesystem.list", "filesystem.write", "filesystem.edit"]
  },
  git: {
    label: "Git",
    tools: ["git.status", "git.diff", "git.log", "git.commit"]
  },
  memory: {
    label: "Memory",
    tools: ["memory.save", "memory.update", "memory.delete"]
  },
  supabase: {
    label: "Database",
    tools: ["supabase.query", "supabase.mutate"]
  },
  browser: {
    label: "Browser",
    tools: ["browser.navigate", "browser.screenshot"]
  },
  email: {
    label: "Email",
    tools: ["email.send", "email.draft"]
  },
  deployment: {
    label: "Deployment",
    tools: ["deploy.render"]
  },
  security: {
    label: "Security (High Impact)",
    tools: ["secret.rotate", "database.migrate", "user.delete", "financial.transfer"]
  }
};

/**
 * Get all tools with their effective permissions for a user.
 * Used by the permissions settings UI.
 */
export async function getAllToolPermissions(userId: string): Promise<
  Array<{ tool: string; category: string; label: string; permission: PermissionLevel }>
> {
  const userPerms = await listToolPermissions(userId);
  const userMap = new Map(userPerms.map((p) => [p.tool_key, p.permission_level]));

  const result: Array<{ tool: string; category: string; label: string; permission: PermissionLevel }> = [];

  for (const [category, { label, tools }] of Object.entries(TOOL_CATEGORIES)) {
    for (const tool of tools) {
      const permission = userMap.get(tool) ?? DEFAULT_PERMISSIONS[tool] ?? "deny";
      result.push({ tool, category, label, permission });
    }
  }

  return result;
}
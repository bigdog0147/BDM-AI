/**
 * Capability Registry — Inventory of all environment integrations.
 *
 * Each capability defines its operations, auth, limits, and approval requirements.
 * The registry is the single source of truth for what BDM-AI can actually do.
 */

export type AuthMechanism =
  | "session"           // Supabase user session (RLS-enforced)
  | "api_key"           // Server-side API key (never exposed to client)
  | "oauth"             // OAuth 2.0 flow (Google, GitHub, etc.)
  | "service_role"      // Supabase service role (server-only, bypasses RLS)
  | "none";             // No auth (local-only, read-only)

export type CapabilityFallback = "deny" | "degrade" | "ask";

export interface CapabilityOperation {
  name: string;
  description: string;
  requiresApproval: boolean;
  permissionKey: string;           // Maps to bdm_tool_permissions.tool_key
  rateLimit?: { windowMs: number; max: number };
  timeoutMs: number;
  inputSchema: Record<string, unknown>;  // JSON Schema for validation
  outputSchema: Record<string, unknown>; // JSON Schema for response
}

export interface Capability {
  key: string;
  name: string;
  description: string;
  category: "read" | "reversible" | "external" | "high-impact";
  auth: AuthMechanism;
  operations: CapabilityOperation[];
  availability: {
    check: () => Promise<{ available: boolean; reason?: string }>;
    requiredEnv?: string[];
  };
  fallback: CapabilityFallback;
  auditEventType: string;
}

/**
 * Check if a capability is available (all required env vars present, service reachable).
 */
async function checkEnvVars(vars: string[]): Promise<{ available: boolean; reason?: string }> {
  const missing = vars.filter((v) => !process.env[v]?.trim());
  if (missing.length > 0) {
    return { available: false, reason: `Missing env: ${missing.join(", ")}` };
  }
  return { available: true };
}

/**
 * Web Search Capability
 */
const webSearch: Capability = {
  key: "search",
  name: "Web Search",
  description: "Search the web via Tavily, Brave, or SearXNG",
  category: "read",
  auth: "api_key",
  operations: [
    {
      name: "search",
      description: "Execute a web search query",
      requiresApproval: false,
      permissionKey: "search.web",
      rateLimit: { windowMs: 60_000, max: 10 },
      timeoutMs: 15_000,
      inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
      outputSchema: { type: "object", properties: { sources: { type: "array" }, tookMs: { type: "number" } } }
    }
  ],
  availability: {
    check: async () => {
      const env = await checkEnvVars(["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "SEARXNG_URL"]);
      if (!env.available) return env;
      // Could add a ping to the API here
      return { available: true };
    },
    requiredEnv: ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "SEARXNG_URL"]
  },
  fallback: "degrade",
  auditEventType: "search"
};

/**
 * Filesystem Capability (read operations)
 */
const filesystemRead: Capability = {
  key: "filesystem.read",
  name: "Filesystem Read",
  description: "Read files and list directories within authorized workspace roots",
  category: "read",
  auth: "session",
  operations: [
    {
      name: "read",
      description: "Read a file's contents",
      requiresApproval: false,
      permissionKey: "filesystem.read",
      timeoutMs: 5_000,
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      outputSchema: { type: "object", properties: { content: { type: "string" }, size: { type: "number" } } }
    },
    {
      name: "list",
      description: "List directory contents",
      requiresApproval: false,
      permissionKey: "filesystem.list",
      timeoutMs: 5_000,
      inputSchema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } }, required: ["path"] },
      outputSchema: { type: "object", properties: { entries: { type: "array" } } }
    }
  ],
  availability: {
    check: async () => ({ available: true }),
    requiredEnv: []
  },
  fallback: "deny",
  auditEventType: "system"
};

/**
 * Filesystem Capability (write operations)
 */
const filesystemWrite: Capability = {
  key: "filesystem.write",
  name: "Filesystem Write",
  description: "Create, edit, or delete files within authorized workspace roots",
  category: "reversible",
  auth: "session",
  operations: [
    {
      name: "write",
      description: "Create or overwrite a file",
      requiresApproval: true,
      permissionKey: "filesystem.write",
      timeoutMs: 5_000,
      inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } } }
    },
    {
      name: "edit",
      description: "Apply a patch/diff to a file",
      requiresApproval: true,
      permissionKey: "filesystem.edit",
      timeoutMs: 5_000,
      inputSchema: { type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] },
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } } }
    },
    {
      name: "delete",
      description: "Delete a file or directory",
      requiresApproval: true,
      permissionKey: "filesystem.write",
      timeoutMs: 5_000,
      inputSchema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } }, required: ["path"] },
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } } }
    }
  ],
  availability: {
    check: async () => ({ available: true }),
    requiredEnv: []
  },
  fallback: "ask",
  auditEventType: "system"
};

/**
 * Git Capability
 */
const git: Capability = {
  key: "git",
  name: "Git",
  description: "Git operations (read by default, write with approval)",
  category: "read",
  auth: "session",
  operations: [
    {
      name: "status",
      description: "Get working tree status",
      requiresApproval: false,
      permissionKey: "git.status",
      timeoutMs: 10_000,
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { clean: { type: "boolean" }, files: { type: "array" } } }
    },
    {
      name: "diff",
      description: "Show changes",
      requiresApproval: false,
      permissionKey: "git.diff",
      timeoutMs: 10_000,
      inputSchema: { type: "object", properties: { staged: { type: "boolean" } } },
      outputSchema: { type: "object", properties: { diff: { type: "string" } } }
    },
    {
      name: "log",
      description: "Show commit history",
      requiresApproval: false,
      permissionKey: "git.log",
      timeoutMs: 10_000,
      inputSchema: { type: "object", properties: { limit: { type: "number" } } },
      outputSchema: { type: "object", properties: { commits: { type: "array" } } }
    },
    {
      name: "commit",
      description: "Create a commit",
      requiresApproval: true,
      permissionKey: "git.commit",
      timeoutMs: 15_000,
      inputSchema: { type: "object", properties: { message: { type: "string" }, addAll: { type: "boolean" } }, required: ["message"] },
      outputSchema: { type: "object", properties: { hash: { type: "string" } } }
    }
  ],
  availability: {
    check: async () => ({ available: true }),
    requiredEnv: []
  },
  fallback: "degrade",
  auditEventType: "system"
};

/**
 * Browser Capability
 */
const browser: Capability = {
  key: "browser",
  name: "Browser Automation",
  description: "Navigate, screenshot, extract content, interact with web pages",
  category: "external",
  auth: "session",
  operations: [
    {
      name: "navigate",
      description: "Navigate to a URL",
      requiresApproval: false,
      permissionKey: "browser.navigate",
      timeoutMs: 30_000,
      inputSchema: { type: "object", properties: { url: { type: "string" }, waitUntil: { type: "string" } }, required: ["url"] },
      outputSchema: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } } }
    },
    {
      name: "screenshot",
      description: "Take a screenshot",
      requiresApproval: false,
      permissionKey: "browser.screenshot",
      timeoutMs: 30_000,
      inputSchema: { type: "object", properties: { fullPage: { type: "boolean" } } },
      outputSchema: { type: "object", properties: { base64: { type: "string" } } }
    },
    {
      name: "eval",
      description: "Execute JavaScript in the page",
      requiresApproval: true,
      permissionKey: "browser.eval",
      timeoutMs: 15_000,
      inputSchema: { type: "object", properties: { script: { type: "string" } }, required: ["script"] },
      outputSchema: { type: "object", properties: { result: {} } }
    },
    {
      name: "click",
      description: "Click an element",
      requiresApproval: true,
      permissionKey: "browser.click",
      timeoutMs: 15_000,
      inputSchema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } } }
    }
  ],
  availability: {
    check: async () => {
      // Check if agent-browser is available
      try {
        // This would check for the browser daemon
        return { available: true };
      } catch {
        return { available: false, reason: "Browser daemon not running" };
      }
    },
    requiredEnv: []
  },
  fallback: "ask",
  auditEventType: "system"
};

/**
 * Supabase Query Capability
 */
const supabaseQuery: Capability = {
  key: "supabase.query",
  name: "Supabase Query",
  description: "Execute read queries against Supabase (RLS-enforced)",
  category: "read",
  auth: "session",
  operations: [
    {
      name: "select",
      description: "Select rows from a table",
      requiresApproval: false,
      permissionKey: "supabase.query",
      timeoutMs: 10_000,
      inputSchema: { type: "object", properties: { table: { type: "string" }, columns: { type: "array" }, filters: { type: "object" }, limit: { type: "number" } }, required: ["table"] },
      outputSchema: { type: "object", properties: { data: { type: "array" }, count: { type: "number" } } }
    }
  ],
  availability: {
    check: async () => checkEnvVars(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]),
    requiredEnv: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
  },
  fallback: "degrade",
  auditEventType: "system"
};

/**
 * Supabase Mutate Capability
 */
const supabaseMutate: Capability = {
  key: "supabase.mutate",
  name: "Supabase Mutate",
  description: "Insert, update, delete rows in Supabase (RLS-enforced, requires approval)",
  category: "external",
  auth: "session",
  operations: [
    {
      name: "insert",
      description: "Insert rows",
      requiresApproval: true,
      permissionKey: "supabase.mutate",
      timeoutMs: 10_000,
      inputSchema: { type: "object", properties: { table: { type: "string" }, data: { type: "object" } }, required: ["table", "data"] },
      outputSchema: { type: "object", properties: { data: { type: "object" } } }
    },
    {
      name: "update",
      description: "Update rows",
      requiresApproval: true,
      permissionKey: "supabase.mutate",
      timeoutMs: 10_000,
      inputSchema: { type: "object", properties: { table: { type: "string" }, data: { type: "object" }, filters: { type: "object" } }, required: ["table", "data"] },
      outputSchema: { type: "object", properties: { data: { type: "object" } } }
    },
    {
      name: "delete",
      description: "Delete rows",
      requiresApproval: true,
      permissionKey: "supabase.mutate",
      timeoutMs: 10_000,
      inputSchema: { type: "object", properties: { table: { type: "string" }, filters: { type: "object" } }, required: ["table"] },
      outputSchema: { type: "object", properties: { count: { type: "number" } } }
    }
  ],
  availability: {
    check: async () => checkEnvVars(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]),
    requiredEnv: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
  },
  fallback: "ask",
  auditEventType: "system"
};

/**
 * Email Capability
 */
const email: Capability = {
  key: "email",
  name: "Email",
  description: "Send transactional emails via Resend",
  category: "external",
  auth: "api_key",
  operations: [
    {
      name: "send",
      description: "Send an email (requires explicit confirmation)",
      requiresApproval: true,
      permissionKey: "email.send",
      timeoutMs: 30_000,
      inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, confirmed: { type: "boolean" } }, required: ["to", "subject", "body", "confirmed"] },
      outputSchema: { type: "object", properties: { sent: { type: "boolean" }, id: { type: "string" } } }
    },
    {
      name: "draft",
      description: "Create an email draft",
      requiresApproval: false,
      permissionKey: "email.draft",
      timeoutMs: 10_000,
      inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] },
      outputSchema: { type: "object", properties: { draftId: { type: "string" } } }
    }
  ],
  availability: {
    check: async () => checkEnvVars(["RESEND_API_KEY", "RESEND_FROM_EMAIL", "BDM_EMAIL_ENABLED"]),
    requiredEnv: ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "BDM_EMAIL_ENABLED"]
  },
  fallback: "degrade",
  auditEventType: "email"
};

/**
 * Render Deployment Capability
 */
const renderDeploy: Capability = {
  key: "deploy.render",
  name: "Render Deploy",
  description: "Trigger deployments on Render",
  category: "high-impact",
  auth: "api_key",
  operations: [
    {
      name: "deploy",
      description: "Trigger a new deployment",
      requiresApproval: true,
      permissionKey: "deploy.render",
      timeoutMs: 60_000,
      inputSchema: { type: "object", properties: { serviceId: { type: "string" }, clearCache: { type: "boolean" } }, required: ["serviceId"] },
      outputSchema: { type: "object", properties: { deployId: { type: "string" }, status: { type: "string" } } }
    }
  ],
  availability: {
    check: async () => checkEnvVars(["RENDER_API_KEY"]),
    requiredEnv: ["RENDER_API_KEY"]
  },
  fallback: "deny",
  auditEventType: "deployment"
};

/**
 * Terminal Capability
 */
const terminal: Capability = {
  key: "terminal",
  name: "Terminal",
  description: "Execute shell commands in a persistent session",
  category: "reversible",
  auth: "session",
  operations: [
    {
      name: "exec",
      description: "Execute a command",
      requiresApproval: true,
      permissionKey: "terminal.exec",
      timeoutMs: 120_000,
      inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeoutMs: { type: "number" } }, required: ["command"] },
      outputSchema: { type: "object", properties: { stdout: { type: "string" }, stderr: { type: "string" }, exitCode: { type: "number" } } }
    },
    {
      name: "spawn",
      description: "Start a long-running process",
      requiresApproval: true,
      permissionKey: "terminal.spawn",
      timeoutMs: 600_000,
      inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, env: { type: "object" } }, required: ["command"] },
      outputSchema: { type: "object", properties: { pid: { type: "number" } } }
    }
  ],
  availability: {
    check: async () => ({ available: true }),
    requiredEnv: []
  },
  fallback: "ask",
  auditEventType: "system"
};

/**
 * Complete capability registry.
 */
export const CAPABILITIES: Capability[] = [
  webSearch,
  filesystemRead,
  filesystemWrite,
  git,
  browser,
  supabaseQuery,
  supabaseMutate,
  email,
  renderDeploy,
  terminal
];

/**
 * Get a capability by key.
 */
export function getCapability(key: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.key === key);
}

/**
 * Get all capabilities, optionally filtered by category.
 */
export function getCapabilities(category?: Capability["category"]): Capability[] {
  if (!category) return CAPABILITIES;
  return CAPABILITIES.filter((c) => c.category === category);
}

/**
 * Check availability of all capabilities.
 */
export async function checkAllCapabilities(): Promise<
  Array<{ capability: Capability; available: boolean; reason?: string }>
> {
  const results = await Promise.all(
    CAPABILITIES.map(async (c) => {
      const check = await c.availability.check();
      return { capability: c, available: check.available, reason: check.reason };
    })
  );
  return results;
}

/**
 * Get the permission key for a capability operation.
 */
export function getOperationPermissionKey(capabilityKey: string, operationName: string): string | null {
  const cap = getCapability(capabilityKey);
  if (!cap) return null;
  const op = cap.operations.find((o) => o.name === operationName);
  return op?.permissionKey ?? null;
}

/**
 * Get the default permission level for a capability operation.
 */
export function getOperationDefaultPermission(capabilityKey: string, operationName: string): "deny" | "ask" | "allow" {
  const cap = getCapability(capabilityKey);
  if (!cap) return "deny";
  const op = cap.operations.find((o) => o.name === operationName);
  if (!op) return "deny";
  return op.requiresApproval ? "ask" : "allow";
}
/**
 * Context Selection & Assembly.
 *
 * Selects and assembles the relevant context for a given goal/task.
 * Respects token budgets, prioritizes relevant memories, and includes
 * only what's needed for the current operation.
 */

import { retrieveRelevantMemories } from "./memory-store";
import { getTask, getTaskSteps } from "./task-executor";
import { getCapabilities, checkAllCapabilities } from "./capabilities";
import type { Memory } from "./bdm-types";

export interface ContextBudget {
  maxTokens: number;
  reserveForResponse: number;
  maxMemories: number;
  maxConversationTurns: number;
  maxToolDescriptions: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxTokens: Number(process.env.BDM_MAX_CONTEXT_TOKENS ?? 8000),
  reserveForResponse: Number(process.env.BDM_MAX_RESPONSE_TOKENS ?? 2000),
  maxMemories: Number(process.env.BDM_MAX_CONTEXT_MEMORIES ?? 6),
  maxConversationTurns: Number(process.env.BDM_MAX_CONTEXT_TURNS ?? 10),
  maxToolDescriptions: Number(process.env.BDM_MAX_TOOL_DESCRIPTIONS ?? 20)
};

export interface TaskContext {
  task: {
    id: string;
    title: string;
    status: string;
    plan: Array<{
      id: string;
      description: string;
      tool: string;
      requiresApproval: boolean;
    }>;
    current_step: number;
    checkpoints: Array<{
      step: number;
      output: unknown;
      verifiedAt: string;
      verified: boolean;
    }>;
  };
  plan: Array<{
    id: string;
    description: string;
    tool: string;
    requiresApproval: boolean;
  }>;
  completedSteps: number;
  checkpoints: Array<{
    step: number;
    output: unknown;
    verifiedAt: string;
    verified: boolean;
  }>;
}

export interface ContextPackage {
  systemPrompt: string;
  memories: Memory[];
  relevantCapabilities: string[];
  taskContext?: TaskContext;
  conversationHistory?: Array<{ role: string; content: string }>;
  workspaceInfo?: {
    projectKey: string | null;
    capabilities: string[];
  };
  budget: ContextBudget;
  estimatedTokens: number;
}

const MEMORY_TOKEN_ESTIMATE = 150; // rough tokens per memory
const CAPABILITY_TOKEN_ESTIMATE = 80;
const TURN_TOKEN_ESTIMATE = 200;

/**
 * Estimate token count for a string (rough approximation).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build the base system prompt with memory context.
 */
export function buildSystemPrompt(basePrompt: string, memories: Memory[]): string {
  if (memories.length === 0) return basePrompt;

  const memoryLines = memories.map(
    (m) => `- [${m.kind}] ${m.content} (confidence: ${m.confidence}%, ${m.source})`
  );

  return [
    basePrompt,
    "",
    "RELEVANT LONG-TERM MEMORIES:",
    "Use these only when relevant. Do not invent memories.",
    ...memoryLines,
    ""
  ].join("\n");
}

/**
 * Select relevant capabilities for the current goal.
 */
export function selectRelevantCapabilities(
  goal: string,
  availableCapabilities: string[]
): string[] {
  const goalLower = goal.toLowerCase();
  const capabilityKeywords: Record<string, string[]> = {
    search: ["search", "find", "look up", "research", "web", "browse"],
    "filesystem.read": ["read", "file", "list", "directory", "cat", "view"],
    "filesystem.write": ["write", "create", "edit", "delete", "save", "modify"],
    git: ["git", "commit", "diff", "status", "log", "branch"],
    browser: ["browser", "navigate", "screenshot", "click", "web page", "site"],
    "supabase.query": ["query", "select", "database", "supabase", "read data"],
    "supabase.mutate": ["insert", "update", "delete", "mutate", "write data"],
    email: ["email", "send", "draft", "mail"],
    "deploy.render": ["deploy", "render", "deployment"],
    terminal: ["terminal", "shell", "command", "exec", "run"]
  };

  const relevant: string[] = [];
  for (const [cap, keywords] of Object.entries(capabilityKeywords)) {
    if (keywords.some((k) => goalLower.includes(k))) {
      relevant.push(cap);
    }
  }

  // Always include read-only capabilities as fallback
  const readOnly = ["search", "filesystem.read", "git", "supabase.query"];
  for (const cap of readOnly) {
    if (!relevant.includes(cap)) relevant.push(cap);
  }

  return relevant.filter((c) => availableCapabilities.includes(c));
}

/**
 * Build tool descriptions for the prompt.
 */
export function buildToolDescriptions(capabilities: string[]): string {
  const caps = getCapabilities();
  const lines: string[] = ["AVAILABLE TOOLS:"];

  for (const key of capabilities) {
    const cap = caps.find((c) => c.key === key);
    if (!cap) continue;

    for (const op of cap.operations) {
      const approval = op.requiresApproval ? " [requires approval]" : "";
      lines.push(
        `- ${op.permissionKey}: ${op.description}${approval}`
      );
    }
  }

  return lines.join("\n");
}

/**
 * Assemble the full context package for a goal/task.
 */
export async function assembleContext(input: {
  goal: string;
  userId: string;
  projectKey?: string | null;
  conversationHistory?: Array<{ role: string; content: string }>;
  taskId?: string;
  budget?: Partial<ContextBudget>;
}): Promise<ContextPackage> {
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...input.budget };

  // 1. Get relevant memories
  const memories = await retrieveRelevantMemories(input.userId, input.goal, {
    project: input.projectKey,
    limit: budget.maxMemories
  });

  // 2. Check available capabilities
  const capabilityCheck = await checkAllCapabilities();
  const availableCapabilities = capabilityCheck
    .filter((c) => c.available)
    .map((c) => c.capability.key);

  // 3. Select relevant capabilities for this goal
  const relevantCapabilities = selectRelevantCapabilities(input.goal, availableCapabilities);

  // 4. Get task context if taskId provided
  let taskContext: ContextPackage["taskContext"] = undefined;
  if (input.taskId) {
    const task = await getTask(input.userId, input.taskId);
    if (task) {
      await getTaskSteps(input.taskId); // Ensure step records exist
      taskContext = {
        task,
        plan: task.plan,
        completedSteps: task.current_step,
        checkpoints: task.checkpoints
      };
    }
  }

  // 5. Build system prompt with memories
  const basePrompt = `You are BDM, a personal AI assistant.
Be capable, clear, practical, and truthful.
Never claim an action succeeded unless it actually did.
Respect user privacy, permission boundaries, applicable law, and security controls.
When current information is needed and web search is available, use it rather than guessing.
Your architecture is designed to gain more tools and memory over time.`;

  const systemPrompt = buildSystemPrompt(basePrompt, memories);

  // 6. Estimate tokens
  let estimatedTokens = estimateTokens(systemPrompt);
  estimatedTokens += memories.length * MEMORY_TOKEN_ESTIMATE;
  estimatedTokens += relevantCapabilities.length * CAPABILITY_TOKEN_ESTIMATE;
  if (input.conversationHistory) {
    estimatedTokens += Math.min(input.conversationHistory.length, budget.maxConversationTurns) * TURN_TOKEN_ESTIMATE;
  }

  return {
    systemPrompt,
    memories,
    relevantCapabilities,
    taskContext,
    conversationHistory: input.conversationHistory?.slice(-budget.maxConversationTurns),
    workspaceInfo: {
      projectKey: input.projectKey ?? null,
      capabilities: relevantCapabilities
    },
    budget,
    estimatedTokens
  };
}

/**
 * Trim context to fit within budget.
 */
export function trimContextToBudget(context: ContextPackage): ContextPackage {
  const budget = context.budget;
  const availableTokens = budget.maxTokens - budget.reserveForResponse;

  if (context.estimatedTokens <= availableTokens) return context;

  // Priority order for trimming:
  // 1. Conversation history (oldest first)
  // 2. Capabilities (least relevant first)
  // 3. Memories (lowest relevance first)
  // 4. Task checkpoints (oldest first)

  const trimmed = { ...context };

  // Trim conversation history
  if (trimmed.conversationHistory && trimmed.conversationHistory.length > 2) {
    trimmed.conversationHistory = trimmed.conversationHistory.slice(-2);
    trimmed.estimatedTokens = estimateTokens(trimmed.systemPrompt) +
      trimmed.memories.length * MEMORY_TOKEN_ESTIMATE +
      trimmed.relevantCapabilities.length * CAPABILITY_TOKEN_ESTIMATE +
      trimmed.conversationHistory.length * TURN_TOKEN_ESTIMATE;
  }

  // Trim capabilities
  if (trimmed.estimatedTokens > availableTokens && trimmed.relevantCapabilities.length > 3) {
    trimmed.relevantCapabilities = trimmed.relevantCapabilities.slice(0, 3);
    trimmed.estimatedTokens = estimateTokens(trimmed.systemPrompt) +
      trimmed.memories.length * MEMORY_TOKEN_ESTIMATE +
      trimmed.relevantCapabilities.length * CAPABILITY_TOKEN_ESTIMATE;
  }

  // Trim memories
  if (trimmed.estimatedTokens > availableTokens && trimmed.memories.length > 2) {
    trimmed.memories = trimmed.memories.slice(0, 2);
    trimmed.estimatedTokens = estimateTokens(trimmed.systemPrompt) +
      trimmed.memories.length * MEMORY_TOKEN_ESTIMATE +
      trimmed.relevantCapabilities.length * CAPABILITY_TOKEN_ESTIMATE;
  }

  // Trim task checkpoints
  if (trimmed.taskContext && trimmed.estimatedTokens > availableTokens) {
    trimmed.taskContext.checkpoints = trimmed.taskContext.checkpoints.slice(-2);
  }

  return trimmed;
}
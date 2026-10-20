/**
 * Agent Framework Types
 * Core interfaces for the multi-agent system
 */

import type { ChatMessage, Tool } from '@/lib/providers/types';

export type TaskState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type AgentType = 
  | 'planner'
  | 'researcher'
  | 'coder'
  | 'analyst'
  | 'executor'
  | 'custom';

export interface AgentCapability {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredPermissions: Permission[];
}

export interface Permission {
  resource: 'filesystem' | 'shell' | 'network' | 'memory' | 'project' | 'provider' | 'database';
  action: 'read' | 'write' | 'execute' | 'delete' | 'admin';
  scope?: string; // e.g., 'project:/path', 'provider:openai'
  conditions?: Record<string, unknown>;
}

export interface ExecutionContext {
  taskId: string;
  projectId: string;
  userId?: string;
  permissions: Permission[];
  workingDirectory: string;
  environment: Record<string, string>;
  metadata: Record<string, unknown>;
  abortSignal: AbortSignal;
}

export interface AgentInput {
  taskId: string;
  type: AgentType;
  payload: Record<string, unknown>;
  context: ExecutionContext;
}

export interface AgentOutput {
  taskId: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
  metadata: {
    durationMs: number;
    tokensUsed?: number;
    provider?: string;
    model?: string;
    toolCalls?: number;
  };
}

export interface Agent {
  readonly type: AgentType;
  readonly name: string;
  readonly description: string;
  readonly capabilities: AgentCapability[];
  readonly requiredPermissions: Permission[];

  /**
   * Execute the agent with the given input
   */
  execute(input: AgentInput): Promise<AgentOutput>;

  /**
   * Validate that the agent can handle the given task
   */
  canHandle(taskType: string, payload: Record<string, unknown>): boolean;
}

export interface Task {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  state: TaskState;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  assignedAgent?: AgentType;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
  parentTaskId?: string;
  dependencies: string[]; // Task IDs this task depends on
  result?: Record<string, unknown>;
  error?: string;
  metadata: Record<string, unknown>;
}

export interface TaskTransition {
  from: TaskState;
  to: TaskState;
  valid: boolean;
  reason?: string;
}

export interface MemoryEntry {
  id: string;
  projectId: string;
  scope: 'task' | 'project' | 'user' | 'global';
  type: 'fact' | 'context' | 'decision' | 'artifact' | 'conversation';
  content: Record<string, unknown>;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  accessCount: number;
  ownerId?: string;
}

export interface MemoryQuery {
  projectId: string;
  scope?: MemoryEntry['scope'];
  type?: MemoryEntry['type'];
  tags?: string[];
  limit?: number;
  offset?: number;
  query?: string; // Semantic search query
}

export interface ProjectContext {
  id: string;
  name: string;
  rootPath: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  settings: {
    allowedPaths: string[];
    excludedPaths: string[];
    maxFileSize: number;
    allowedCommands: string[];
    memoryRetentionDays: number;
  };
  metadata: Record<string, unknown>;
}

export interface AgentRegistration {
  type: AgentType;
  agent: Agent;
  priority: number;
  enabled: boolean;
}

export interface OrchestrationPlan {
  id: string;
  requestId: string;
  tasks: Task[];
  createdAt: Date;
  estimatedDurationMs: number;
  metadata: Record<string, unknown>;
}

export interface OrchestrationResult {
  planId: string;
  success: boolean;
  completedTasks: number;
  failedTasks: number;
  results: Record<string, AgentOutput>;
  errors: Array<{ taskId: string; error: string }>;
  totalDurationMs: number;
}

export interface TaskStats {
  total: number;
  byState: Record<TaskState, number>;
  running: number;
  queued: number;
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<string, number>;
  byScope: Record<string, number>;
  totalSize: number;
  oldestEntry?: Date;
  newestEntry?: Date;
}
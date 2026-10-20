/**
 * MasterAgent
 * Top-level coordinator that accepts user requests and manages the agent system
 */

import type {
  AgentType,
  ExecutionContext,
  AgentInput,
  AgentOutput,
  Permission,
  OrchestrationResult,
  Agent,
  TaskStats,
  MemoryStats,
} from './types';
import type { ChatMessage } from '@/lib/providers/types';
import { getOrchestrator } from './Orchestrator';
import { getTaskManager } from './TaskManager';
import { getMemoryManager } from './MemoryManager';
import { permissionManager } from './PermissionManager';
import { agentRegistry } from './Agent';

export interface MasterAgentConfig {
  enableOrchestration: boolean;
  defaultTimeoutMs: number;
  maxOrchestrationDepth: number;
}

const DEFAULT_CONFIG: MasterAgentConfig = {
  enableOrchestration: true,
  defaultTimeoutMs: 600000, // 10 minutes
  maxOrchestrationDepth: 3,
};

export interface MasterAgentRequest {
  requestId: string;
  userId?: string;
  projectId: string;
  message: string;
  context?: Record<string, unknown>;
  options?: {
    useOrchestration?: boolean;
    preferredProvider?: 'openai' | 'ollama';
    preferredAgents?: AgentType[];
    constraints?: string[];
    maxTasks?: number;
    conversationHistory?: ChatMessage[];
  };
}

export interface MasterAgentResponse {
  requestId: string;
  success: boolean;
  response?: string;
  orchestration?: OrchestrationResult;
  error?: string;
  metadata: {
    durationMs: number;
    tasksExecuted: number;
    provider?: string;
    model?: string;
  };
}

export class MasterAgent {
  private config: MasterAgentConfig;
  private orchestrator = getOrchestrator();
  private taskManager = getTaskManager();
  private memoryManager = getMemoryManager();

  constructor(config: Partial<MasterAgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process a user request through the agent system
   */
  async processRequest(request: MasterAgentRequest): Promise<MasterAgentResponse> {
    const startTime = Date.now();
    const { requestId, userId, projectId, message, context, options = {} } = request;

    try {
      // Create execution context
      const execContext: ExecutionContext = {
        taskId: requestId,
        projectId,
        userId,
        permissions: this.getDefaultPermissions(),
        workingDirectory: process.cwd(),
        environment: Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined)
        ) as Record<string, string>,
        metadata: context || {},
        abortSignal: new AbortSignal(),
      };

      // Determine if we should use orchestration
      const useOrchestration = this.config.enableOrchestration && (options.useOrchestration !== false);
      
      if (useOrchestration && this.shouldOrchestrate(message)) {
        // Use full orchestration for complex requests
        const result = await this.orchestrator.orchestrate(
          requestId,
          message,
          execContext,
          {
            constraints: options.constraints,
            preferredAgents: options.preferredAgents,
            maxTasks: options.maxTasks,
          }
        );

        // Synthesize final response
        const response = this.synthesizeResponse(result, message);

        return {
          requestId,
          success: result.success,
          response,
          orchestration: result,
          metadata: {
            durationMs: Date.now() - startTime,
            tasksExecuted: result.completedTasks + result.failedTasks,
            provider: this.getDefaultProvider(),
          },
        };
      } else {
        // Simple direct response for simple queries
        const response = await this.directResponse(
          message, 
          execContext, 
          options.preferredProvider,
          options.conversationHistory
        );

        return {
          requestId,
          success: true,
          response,
          metadata: {
            durationMs: Date.now() - startTime,
            tasksExecuted: 0,
            provider: options.preferredProvider || this.getDefaultProvider(),
          },
        };
      }
    } catch (error) {
      return {
        requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Master agent processing failed',
        metadata: {
          durationMs: Date.now() - startTime,
          tasksExecuted: 0,
        },
      };
    }
  }

  /**
   * Determine if a request should use orchestration
   */
  private shouldOrchestrate(message: string): boolean {
    // Complex requests that benefit from multi-agent orchestration
    const complexIndicators = [
      'implement',
      'create',
      'build',
      'design',
      'architecture',
      'refactor',
      'analyze',
      'research',
      'investigate',
      'plan',
      'multi-step',
      'workflow',
      'pipeline',
      'system',
      'application',
      'feature',
      'module',
      'service',
    ];

    const lowerMessage = message.toLowerCase();
    
    // Check for complex indicators
    if (complexIndicators.some(indicator => lowerMessage.includes(indicator))) {
      return true;
    }

    // Check for multiple distinct tasks
    const taskSeparators = [' and then ', ' then ', ' after that ', ' followed by '];
    if (taskSeparators.some(sep => lowerMessage.includes(sep))) {
      return true;
    }

    return false;
  }

  /**
   * Generate a direct response using the model provider
   */
  private async directResponse(
    message: string,
    context: ExecutionContext,
    preferredProvider?: 'openai' | 'ollama',
    conversationHistory?: ChatMessage[]
  ): Promise<string> {
    const { getProvider } = await import('@/lib/providers');
    const provider = getProvider(preferredProvider);

    const systemPrompt = `You are BDM, a personal AI assistant.
Be capable, clear, practical, and truthful.
Never claim an action succeeded unless it actually did.
Respect user privacy, permission boundaries, applicable law, and security controls.`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...(conversationHistory || []),
      { role: 'user' as const, content: message },
    ];

    const completion = await provider.chatComplete({
      model: provider.config.model,
      messages,
      maxTokens: 2000,
      temperature: 0.7,
    });

    return completion.content || 'I could not generate a response.';
  }

  /**
   * Synthesize a final response from orchestration results
   */
  private synthesizeResponse(result: OrchestrationResult, originalMessage: string): string {
    if (!result.success && result.completedTasks === 0) {
      return `I attempted to orchestrate a solution for "${originalMessage}" but encountered errors:\n${result.errors.map(e => `- ${e.taskId}: ${e.error}`).join('\n')}`;
    }

    const parts: string[] = [];
    
    if (result.completedTasks > 0) {
      parts.push(`Successfully completed ${result.completedTasks} task(s).`);
    }

    if (result.failedTasks > 0) {
      parts.push(`${result.failedTasks} task(s) failed:\n${result.errors.map(e => `- ${e.taskId}: ${e.error}`).join('\n')}`);
    }

    // Include key results
    for (const [taskId, output] of Object.entries(result.results)) {
      if (output.success && output.result) {
        const summary = this.summarizeTaskResult(taskId, output.result);
        if (summary) parts.push(summary);
      }
    }

    return parts.join('\n\n') || 'Orchestration completed with no specific output.';
  }

  private summarizeTaskResult(taskId: string, result: Record<string, unknown>): string | null {
    // Extract meaningful summaries from task results
    if (result.plan) return `Plan created with ${(result.plan as any).steps?.length || 0} steps`;
    if (result.findings) return `Research found ${(result.findings as any[]).length} findings`;
    if (result.implementation) return 'Code implementation completed';
    if (result.issues) return `Analysis found ${(result.issues as any[]).length} issues`;
    if (result.stdout) return `Command executed: ${(result.stdout as string).slice(0, 100)}`;
    return null;
  }

  /**
   * Get default permissions for execution context
   */
  private getDefaultPermissions(): Permission[] {
    return [
      { resource: 'memory', action: 'read', scope: 'project:*' },
      { resource: 'memory', action: 'write', scope: 'project:*' },
      { resource: 'project', action: 'read', scope: 'project:*' },
      { resource: 'network', action: 'read', scope: 'https:*' },
    ];
  }

  private getDefaultProvider(): string {
    // This would be determined by provider registry
    return 'openai';
  }

  /**
   * Get system status
   */
  getStatus(projectId?: string): {
    orchestrationEnabled: boolean;
    activeOrchestrations: number;
    taskStats: TaskStats;
    memoryStats: MemoryStats | null;
    registeredAgents: string[];
  } {
    return {
      orchestrationEnabled: this.config.enableOrchestration,
      activeOrchestrations: this.orchestrator.getActivePlans().length,
      taskStats: this.taskManager.getStats(),
      memoryStats: projectId ? this.memoryManager.getProjectStats(projectId) : null,
      registeredAgents: agentRegistry.getAll().map(a => a.type),
    };
  }

  /**
   * Enable/disable orchestration
   */
  setOrchestrationEnabled(enabled: boolean): void {
    this.config.enableOrchestration = enabled;
  }

  /**
   * Register a custom agent
   */
  registerAgent(agent: Agent): void {
    agentRegistry.register(agent);
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(type: AgentType): boolean {
    return agentRegistry.unregister(type);
  }
}

// Singleton
let masterAgentInstance: MasterAgent | null = null;

export function getMasterAgent(config?: Partial<MasterAgentConfig>): MasterAgent {
  if (!masterAgentInstance) {
    masterAgentInstance = new MasterAgent(config);
  }
  return masterAgentInstance;
}

export function resetMasterAgent(): void {
  masterAgentInstance = null;
}
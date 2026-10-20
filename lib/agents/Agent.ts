/**
 * Base Agent Class
 * Abstract base class for all agents
 */

import type {
  Agent,
  AgentType,
  AgentCapability,
  AgentInput,
  AgentOutput,
  Permission,
  ExecutionContext,
} from './types';
import { getProvider, type ModelProvider, type ChatCompletionOptions, type ChatMessage, type Tool } from '@/lib/providers';
import { permissionManager } from './PermissionManager';

export abstract class BaseAgent implements Agent {
  abstract readonly type: AgentType;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly capabilities: AgentCapability[];
  abstract readonly requiredPermissions: Permission[];

  protected provider: ModelProvider | null = null;

  constructor(protected config: { providerType?: 'openai' | 'ollama'; model?: string } = {}) {}

  /**
   * Get or initialize the model provider
   */
  protected async getProvider(): Promise<ModelProvider> {
    if (!this.provider) {
      this.provider = getProvider(this.config.providerType);
    }
    return this.provider;
  }

  /**
   * Execute the agent - must be implemented by subclasses
   */
  abstract execute(input: AgentInput): Promise<AgentOutput>;

  /**
   * Check if this agent can handle a task type
   */
  canHandle(taskType: string, payload: Record<string, unknown>): boolean {
    return this.capabilities.some(cap => 
      taskType.includes(cap.name.toLowerCase()) || 
      cap.name.toLowerCase().includes(taskType.toLowerCase())
    );
  }

  /**
   * Validate permissions before execution
   */
  protected validatePermissions(context: ExecutionContext): { allowed: boolean; missing: Permission[] } {
    const result = permissionManager.checkPermissions(this.type, this.requiredPermissions, {
      projectId: context.projectId,
    });
    return {
      allowed: result.denied.length === 0,
      missing: result.denied,
    };
  }

  /**
   * Call the model provider with a prompt
   */
  protected async callModel(
    messages: ChatMessage[],
    options: Partial<ChatCompletionOptions> = {}
  ): Promise<string> {
    const provider = await this.getProvider();
    
    const completion = await provider.chatComplete({
      model: this.config.model || provider.config.model,
      messages,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens,
      tools: options.tools,
      toolChoice: options.toolChoice,
    });

    return completion.content || '';
  }

  /**
   * Call the model with structured output (JSON)
   */
  protected async callModelJson<T>(
    messages: ChatMessage[],
    schema: Record<string, unknown>,
    options: Partial<ChatCompletionOptions> = {}
  ): Promise<T> {
    const provider = await this.getProvider();
    const capabilities = provider.getModelCapabilities();

    if (!capabilities?.supportsJsonMode) {
      throw new Error(`Provider ${provider.type} does not support JSON mode`);
    }

    const completion = await provider.chatComplete({
      model: this.config.model || provider.config.model,
      messages,
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens,
      responseFormat: { type: 'json_object' },
    });

    try {
      return JSON.parse(completion.content || '{}') as T;
    } catch {
      throw new Error('Failed to parse JSON response from model');
    }
  }

  /**
   * Create a standardized agent output
   */
  protected createOutput(
    taskId: string,
    success: boolean,
    result?: Record<string, unknown>,
    error?: string,
    metadata: Partial<AgentOutput['metadata']> = {}
  ): AgentOutput {
    return {
      taskId,
      success,
      result,
      error,
      metadata: {
        durationMs: 0, // Will be set by runner
        tokensUsed: metadata.tokensUsed,
        provider: metadata.provider,
        model: metadata.model,
        toolCalls: metadata.toolCalls,
      },
    };
  }
}

/**
 * Agent Registry
 * Manages agent registration and lookup
 */
export class AgentRegistry {
  private agents = new Map<AgentType, Agent>();
  private agentMetadata = new Map<AgentType, { priority: number; enabled: boolean }>();

  register(agent: Agent, options: { priority?: number; enabled?: boolean } = {}): void {
    this.agents.set(agent.type, agent);
    this.agentMetadata.set(agent.type, {
      priority: options.priority ?? 0,
      enabled: options.enabled ?? true,
    });
  }

  unregister(type: AgentType): boolean {
    this.agentMetadata.delete(type);
    return this.agents.delete(type);
  }

  get(type: AgentType): Agent | undefined {
    const meta = this.agentMetadata.get(type);
    if (meta?.enabled === false) return undefined;
    return this.agents.get(type);
  }

  getAll(): Agent[] {
    return Array.from(this.agents.entries())
      .filter(([type]) => this.agentMetadata.get(type)?.enabled !== false)
      .map(([, agent]) => agent)
      .sort((a, b) => {
        const metaA = this.agentMetadata.get(a.type);
        const metaB = this.agentMetadata.get(b.type);
        return (metaB?.priority ?? 0) - (metaA?.priority ?? 0);
      });
  }

  findForTask(taskType: string, payload: Record<string, unknown>): Agent | undefined {
    return this.getAll().find(agent => agent.canHandle(taskType, payload));
  }

  isEnabled(type: AgentType): boolean {
    return this.agentMetadata.get(type)?.enabled ?? false;
  }

  setEnabled(type: AgentType, enabled: boolean): void {
    const meta = this.agentMetadata.get(type);
    if (meta) {
      meta.enabled = enabled;
    }
  }
}

export const agentRegistry = new AgentRegistry();

/**
 * Register all built-in agents
 */
export function registerBuiltinAgents(): void {
  // Import dynamically to avoid circular dependencies
  import('./BuiltinAgents').then(({ 
    PlannerAgent, 
    ResearcherAgent, 
    CoderAgent, 
    AnalystAgent, 
    ExecutorAgent 
  }) => {
    agentRegistry.register(new PlannerAgent(), { priority: 10, enabled: true });
    agentRegistry.register(new ResearcherAgent(), { priority: 8, enabled: true });
    agentRegistry.register(new CoderAgent(), { priority: 8, enabled: true });
    agentRegistry.register(new AnalystAgent(), { priority: 6, enabled: true });
    agentRegistry.register(new ExecutorAgent(), { priority: 5, enabled: true });
  });
}
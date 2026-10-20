/**
 * Dispatcher
 * Routes tasks to appropriate agents based on type and capabilities
 */

import type { Agent, AgentType, AgentInput, AgentOutput, ExecutionContext } from './types';
import { agentRegistry } from './Agent';
import { getTaskManager } from './TaskManager';

export interface DispatcherConfig {
  maxConcurrentPerAgent: number;
  defaultTimeoutMs: number;
}

const DEFAULT_CONFIG: DispatcherConfig = {
  maxConcurrentPerAgent: 3,
  defaultTimeoutMs: 300000,
};

export class Dispatcher {
  private config: DispatcherConfig;
  private agentLoads = new Map<AgentType, number>();

  constructor(config: Partial<DispatcherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Dispatch a task to the best available agent
   */
  async dispatch(input: AgentInput): Promise<AgentOutput> {
    const agent = this.selectAgent(input);
    if (!agent) {
      return {
        taskId: input.taskId,
        success: false,
        error: `No suitable agent found for task type: ${input.type}`,
        metadata: { durationMs: 0 },
      };
    }

    // Check agent load
    const currentLoad = this.agentLoads.get(agent.type) || 0;
    if (currentLoad >= this.config.maxConcurrentPerAgent) {
      return {
        taskId: input.taskId,
        success: false,
        error: `Agent ${agent.type} is at capacity (${currentLoad}/${this.config.maxConcurrentPerAgent})`,
        metadata: { durationMs: 0 },
      };
    }

    // Execute with load tracking
    this.agentLoads.set(agent.type, currentLoad + 1);
    const startTime = Date.now();

    try {
      const result = await agent.execute(input);
      return {
        ...result,
        metadata: {
          ...result.metadata,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      return {
        taskId: input.taskId,
        success: false,
        error: error instanceof Error ? error.message : 'Agent execution failed',
        metadata: { durationMs: Date.now() - startTime },
      };
    } finally {
      this.agentLoads.set(agent.type, Math.max(0, (this.agentLoads.get(agent.type) || 1) - 1));
    }
  }

  /**
   * Select the best agent for a task
   */
  private selectAgent(input: AgentInput): Agent | undefined {
    // First, try to find an agent that explicitly handles this task type
    let agent = agentRegistry.findForTask(input.type, input.payload);
    if (agent) return agent;

    // Fall back to type-based matching
    agent = agentRegistry.get(input.type as AgentType);
    if (agent) return agent;

    // Try to match by capability
    for (const a of agentRegistry.getAll()) {
      if (a.canHandle(input.type, input.payload)) {
        return a;
      }
    }

    return undefined;
  }

  /**
   * Get current load for an agent type
   */
  getAgentLoad(type: AgentType): number {
    return this.agentLoads.get(type) || 0;
  }

  /**
   * Get all agent loads
   */
  getAllLoads(): Record<AgentType, number> {
    const loads: Record<AgentType, number> = {} as Record<AgentType, number>;
    for (const [type, load] of this.agentLoads.entries()) {
      loads[type] = load;
    }
    return loads;
  }

  /**
   * Check if an agent type is available
   */
  isAgentAvailable(type: AgentType): boolean {
    const agent = agentRegistry.get(type);
    if (!agent) return false;
    const load = this.agentLoads.get(type) || 0;
    return load < this.config.maxConcurrentPerAgent;
  }
}

// Singleton
let dispatcherInstance: Dispatcher | null = null;

export function getDispatcher(config?: Partial<DispatcherConfig>): Dispatcher {
  if (!dispatcherInstance) {
    dispatcherInstance = new Dispatcher(config);
  }
  return dispatcherInstance;
}

export function resetDispatcher(): void {
  dispatcherInstance = null;
}
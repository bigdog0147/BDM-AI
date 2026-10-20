/**
 * Orchestrator
 * Coordinates multi-agent task execution with dependency management
 */

import type {
  Task,
  TaskState,
  AgentType,
  OrchestrationPlan,
  OrchestrationResult,
  ExecutionContext,
  AgentInput,
  AgentOutput,
} from './types';
import { getTaskManager } from './TaskManager';
import { getDispatcher } from './Dispatcher';
import { getMemoryManager } from './MemoryManager';
import { permissionManager } from './PermissionManager';

export interface OrchestratorConfig {
  maxConcurrentTasks: number;
  defaultTaskTimeoutMs: number;
  maxRetries: number;
  enablePartialResults: boolean;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxConcurrentTasks: 5,
  defaultTaskTimeoutMs: 300000,
  maxRetries: 3,
  enablePartialResults: true,
};

export class Orchestrator {
  private config: OrchestratorConfig;
  private taskManager = getTaskManager();
  private dispatcher = getDispatcher();
  private memoryManager = getMemoryManager();
  private activePlans = new Map<string, OrchestrationPlan>();
  private planCounter = 0;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create and execute an orchestration plan from a high-level request
   */
  async orchestrate(
    requestId: string,
    goal: string,
    context: ExecutionContext,
    options: {
      constraints?: string[];
      preferredAgents?: AgentType[];
      maxTasks?: number;
    } = {}
  ): Promise<OrchestrationResult> {
    const planId = `plan_${Date.now()}_${++this.planCounter}`;
    const startTime = Date.now();

    try {
      // Create execution plan
      const plan = await this.createPlan(planId, requestId, goal, context, options);
      this.activePlans.set(planId, plan);

      // Execute plan
      const result = await this.executePlan(plan, context);
      
      return {
        ...result,
        planId,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        planId,
        success: false,
        completedTasks: 0,
        failedTasks: 1,
        results: {},
        errors: [{ taskId: 'orchestrator', error: error instanceof Error ? error.message : 'Orchestration failed' }],
        totalDurationMs: Date.now() - startTime,
      };
    } finally {
      this.activePlans.delete(planId);
    }
  }

  /**
   * Create an execution plan using the planner agent
   */
  private async createPlan(
    planId: string,
    requestId: string,
    goal: string,
    context: ExecutionContext,
    options: { constraints?: string[]; preferredAgents?: AgentType[]; maxTasks?: number }
  ): Promise<OrchestrationPlan> {
    // Use planner agent to create plan
    const plannerInput: AgentInput = {
      taskId: `${planId}_planner`,
      type: 'planner',
      payload: {
        goal,
        context: { projectId: context.projectId, ...context.metadata },
        constraints: options.constraints,
      },
      context,
    };

    // Dispatch to planner
    const plannerResult = await this.dispatcher.dispatch(plannerInput);
    
    let tasks: Task[] = [];
    
    const planResult = plannerResult.result as { plan?: { steps: Array<{ id: string; type: string; description: string; dependencies: string[]; estimatedDurationMs: number }> } } | undefined;
    
    if (plannerResult.success && planResult?.plan?.steps) {
      // Convert planner steps to tasks
      tasks = planResult.plan.steps.map((step: any, index: number) => 
        this.taskManager.createTask(
          step.type,
          { description: step.description, ...step },
          {
            parentTaskId: undefined,
            dependencies: step.dependencies || [],
            timeoutMs: step.estimatedDurationMs || this.config.defaultTaskTimeoutMs,
            metadata: { planId, requestId, stepIndex: index },
          }
        )
      );
    } else {
      // Fallback: create a single task
      tasks = [
        this.taskManager.createTask(
          'execute',
          { goal, ...options },
          { timeoutMs: this.config.defaultTaskTimeoutMs, metadata: { planId, requestId } }
        ),
      ];
    }

    // Limit tasks if specified
    if (options.maxTasks && tasks.length > options.maxTasks) {
      tasks = tasks.slice(0, options.maxTasks);
    }

    return {
      id: planId,
      requestId,
      tasks,
      createdAt: new Date(),
      estimatedDurationMs: tasks.reduce((sum, t) => sum + t.timeoutMs, 0),
      metadata: { goal, options },
    };
  }

  /**
   * Execute an orchestration plan
   */
  private async executePlan(plan: OrchestrationPlan, context: ExecutionContext): Promise<OrchestrationResult> {
    const results: Record<string, AgentOutput> = {};
    const errors: Array<{ taskId: string; error: string }> = [];
    let completedTasks = 0;
    let failedTasks = 0;

    // Create a map for quick lookup
    const taskMap = new Map(plan.tasks.map(t => [t.id, t]));
    
    // Track which tasks have been processed
    const processed = new Set<string>();
    const running = new Map<string, Promise<AgentOutput>>();

    while (processed.size < plan.tasks.length) {
      // Find runnable tasks
      const runnable = plan.tasks.filter(task => 
        !processed.has(task.id) &&
        !running.has(task.id) &&
        task.dependencies.every(depId => processed.has(depId) || results[depId]?.success)
      );

      // Start runnable tasks up to concurrency limit
      for (const task of runnable) {
        if (running.size >= this.config.maxConcurrentTasks) break;

        const promise = this.executeTask(task, context).then(result => {
          running.delete(task.id);
          return result;
        });

        running.set(task.id, promise);
      }

      // Wait for at least one task to complete
      if (running.size > 0) {
        const completed = await Promise.race(running.values());
        const completedTaskId = Array.from(running.entries()).find(([, p]) => p === Promise.resolve(completed))?.[0];
        
        if (completedTaskId) {
          const task = taskMap.get(completedTaskId)!;
          processed.add(completedTaskId);
          results[completedTaskId] = completed;
          
          if (completed.success) {
            completedTasks++;
            this.taskManager.completeTask(completedTaskId, completed.result || {});
          } else {
            failedTasks++;
            errors.push({ taskId: completedTaskId, error: completed.error || 'Unknown error' });
            this.taskManager.failTask(completedTaskId, completed.error || 'Unknown error');
            
            // Handle failure - retry or stop
            if (task.retryCount < task.maxRetries) {
              const retried = this.taskManager.retryTask(completedTaskId);
              if (retried) {
                processed.delete(completedTaskId);
                // Will be picked up in next iteration
              }
            } else if (!this.config.enablePartialResults) {
              // Stop on failure if partial results not enabled
              break;
            }
          }
        }
      } else if (runnable.length === 0 && running.size === 0) {
        // Deadlock or all remaining tasks have unmet dependencies
        const remaining = plan.tasks.filter(t => !processed.has(t.id));
        for (const task of remaining) {
          errors.push({ taskId: task.id, error: 'Unmet dependencies or circular dependency' });
          failedTasks++;
        }
        break;
      }
    }

    const success = failedTasks === 0 || (this.config.enablePartialResults && completedTasks > 0);

    return {
      planId: plan.id,
      success,
      completedTasks,
      failedTasks,
      results,
      errors,
      totalDurationMs: 0, // Set by caller
    };
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: Task, context: ExecutionContext): Promise<AgentOutput> {
    // Determine agent type from task
    const agentType = this.inferAgentType(task.type);
    
    // Check permissions
    const agent = await import('./Agent').then(m => m.agentRegistry.get(agentType));
    if (agent) {
      const permCheck = permissionManager.checkPermissions(agentType, agent.requiredPermissions, {
        projectId: context.projectId,
      });
      if (permCheck.denied.length > 0) {
        return {
          taskId: task.id,
          success: false,
          error: `Permission denied: ${permCheck.denied.map(p => `${p.resource}:${p.action}`).join(', ')}`,
          metadata: { durationMs: 0 },
        };
      }
    }

    // Dispatch to agent
    const agentInput: AgentInput = {
      taskId: task.id,
      type: agentType,
      payload: task.payload,
      context,
    };

    return this.dispatcher.dispatch(agentInput);
  }

  /**
   * Infer agent type from task type string
   */
  private inferAgentType(taskType: string): AgentType {
    const typeMap: Record<string, AgentType> = {
      plan: 'planner',
      research: 'researcher',
      search: 'researcher',
      implement: 'coder',
      code: 'coder',
      refactor: 'coder',
      test: 'coder',
      analyze: 'analyst',
      review: 'analyst',
      audit: 'analyst',
      execute: 'executor',
      run: 'executor',
    };

    for (const [key, type] of Object.entries(typeMap)) {
      if (taskType.toLowerCase().includes(key)) return type;
    }

    return 'executor'; // Default
  }

  /**
   * Get active plan
   */
  getActivePlan(planId: string): OrchestrationPlan | undefined {
    return this.activePlans.get(planId);
  }

  /**
   * Get all active plans
   */
  getActivePlans(): OrchestrationPlan[] {
    return Array.from(this.activePlans.values());
  }

  /**
   * Cancel a plan
   */
  async cancelPlan(planId: string): Promise<boolean> {
    const plan = this.activePlans.get(planId);
    if (!plan) return false;

    for (const task of plan.tasks) {
      if (task.state === 'queued' || task.state === 'running') {
        this.taskManager.cancelTask(task.id);
      }
    }

    this.activePlans.delete(planId);
    return true;
  }
}

// Singleton
let orchestratorInstance: Orchestrator | null = null;

export function getOrchestrator(config?: Partial<OrchestratorConfig>): Orchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new Orchestrator(config);
  }
  return orchestratorInstance;
}

export function resetOrchestrator(): void {
  orchestratorInstance = null;
}
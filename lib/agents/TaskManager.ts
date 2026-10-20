/**
 * Task Manager
 * Manages task lifecycle, state transitions, and execution coordination
 */

import type { Task, TaskState, TaskTransition, AgentType, TaskStats } from './types';
import { EventEmitter } from 'events';

export interface TaskManagerConfig {
  maxConcurrentTasks: number;
  defaultTimeoutMs: number;
  defaultMaxRetries: number;
  cleanupIntervalMs: number;
  maxTaskHistory: number;
}

const DEFAULT_CONFIG: TaskManagerConfig = {
  maxConcurrentTasks: 10,
  defaultTimeoutMs: 300000, // 5 minutes
  defaultMaxRetries: 3,
  cleanupIntervalMs: 60000, // 1 minute
  maxTaskHistory: 1000,
};

const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: ['queued'], // Can retry
  cancelled: [],
};

export class TaskManager extends EventEmitter {
  private tasks = new Map<string, Task>();
  private runningTasks = new Set<string>();
  private config: TaskManagerConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private taskCounter = 0;

  constructor(config: Partial<TaskManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
  }

  /**
   * Create a new task
   */
  createTask(
    type: string,
    payload: Record<string, unknown>,
    options: {
      parentTaskId?: string;
      dependencies?: string[];
      maxRetries?: number;
      timeoutMs?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): Task {
    const now = new Date();
    const taskId = `task_${Date.now()}_${++this.taskCounter}`;

    const task: Task = {
      id: taskId,
      type,
      payload,
      state: 'queued',
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.config.defaultMaxRetries,
      timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs,
      parentTaskId: options.parentTaskId,
      dependencies: options.dependencies || [],
      metadata: options.metadata || {},
    };

    this.tasks.set(taskId, task);
    this.emit('taskCreated', task);
    return task;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks (optionally filtered by state)
   */
  getTasks(filter?: { state?: TaskState; type?: string; parentTaskId?: string }): Task[] {
    let tasks = Array.from(this.tasks.values());

    if (filter?.state) {
      tasks = tasks.filter(t => t.state === filter.state);
    }
    if (filter?.type) {
      tasks = tasks.filter(t => t.type === filter.type);
    }
    if (filter?.parentTaskId) {
      tasks = tasks.filter(t => t.parentTaskId === filter.parentTaskId);
    }

    return tasks.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * Validate a state transition
   */
  validateTransition(from: TaskState, to: TaskState): TaskTransition {
    const validTransitions = VALID_TRANSITIONS[from] || [];
    const valid = validTransitions.includes(to);

    return {
      from,
      to,
      valid,
      reason: valid ? undefined : `Invalid transition from ${from} to ${to}`,
    };
  }

  /**
   * Transition a task to a new state
   */
  transitionTask(taskId: string, newState: TaskState, data?: { result?: Record<string, unknown>; error?: string }): Task | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const transition = this.validateTransition(task.state, newState);
    if (!transition.valid) {
      this.emit('transitionError', { taskId, transition });
      return null;
    }

    const now = new Date();
    const previousState = task.state;

    task.state = newState;
    task.updatedAt = now;

    if (newState === 'running') {
      task.startedAt = now;
      this.runningTasks.add(taskId);
    } else if (newState === 'succeeded' || newState === 'failed' || newState === 'cancelled') {
      task.completedAt = now;
      this.runningTasks.delete(taskId);
      if (data?.result) task.result = data.result;
      if (data?.error) task.error = data.error;
    }

    this.emit('taskStateChanged', { task, previousState, newState });
    return task;
  }

  /**
   * Start a task (transition to running)
   */
  startTask(taskId: string): Task | null {
    return this.transitionTask(taskId, 'running');
  }

  /**
   * Complete a task successfully
   */
  completeTask(taskId: string, result: Record<string, unknown>): Task | null {
    return this.transitionTask(taskId, 'succeeded', { result });
  }

  /**
   * Fail a task
   */
  failTask(taskId: string, error: string): Task | null {
    return this.transitionTask(taskId, 'failed', { error });
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): Task | null {
    return this.transitionTask(taskId, 'cancelled');
  }

  /**
   * Retry a failed task
   */
  retryTask(taskId: string): Task | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (task.state !== 'failed') return null;
    if (task.retryCount >= task.maxRetries) return null;

    task.retryCount++;
    task.updatedAt = new Date();
    task.error = undefined;
    task.result = undefined;
    task.startedAt = undefined;
    task.completedAt = undefined;

    return this.transitionTask(taskId, 'queued');
  }

  /**
   * Check if all dependencies of a task are satisfied
   */
  areDependenciesMet(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    return task.dependencies.every(depId => {
      const dep = this.tasks.get(depId);
      return dep?.state === 'succeeded';
    });
  }

  /**
   * Get tasks that are ready to run (queued, dependencies met, within concurrency limit)
   */
  getRunnableTasks(agentType?: AgentType): Task[] {
    if (this.runningTasks.size >= this.config.maxConcurrentTasks) {
      return [];
    }

    return this.getTasks({ state: 'queued' })
      .filter(task => this.areDependenciesMet(task.id))
      .filter(task => !agentType || this.taskMatchesAgent(task, agentType))
      .slice(0, this.config.maxConcurrentTasks - this.runningTasks.size);
  }

  private taskMatchesAgent(task: Task, agentType: AgentType): boolean {
    // Simple mapping - in practice, this could be more sophisticated
    const agentTypeMap: Record<AgentType, string[]> = {
      planner: ['planner'],
      researcher: ['research', 'search', 'browse'],
      coder: ['code', 'implement', 'refactor', 'test'],
      analyst: ['analyze', 'review', 'audit'],
      executor: ['execute', 'run', 'deploy'],
      custom: [],
    };

    const matchingTypes = agentTypeMap[agentType] || [agentType];
    return matchingTypes.some(t => task.type.includes(t));
  }

  /**
   * Get currently running task count
   */
  getRunningCount(): number {
    return this.runningTasks.size;
  }

  /**
   * Check if more tasks can be started
   */
  canStartMoreTasks(): boolean {
    return this.runningTasks.size < this.config.maxConcurrentTasks;
  }

  /**
   * Get task statistics
   */
  getStats(): TaskStats {
    const byState: Record<TaskState, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of this.tasks.values()) {
      byState[task.state]++;
    }

    return {
      total: this.tasks.size,
      byState,
      running: this.runningTasks.size,
      queued: byState.queued,
    };
  }

  /**
   * Clean up old completed tasks
   */
  private cleanup(): void {
    const tasks = Array.from(this.tasks.values())
      .filter(t => t.state === 'succeeded' || t.state === 'failed' || t.state === 'cancelled')
      .sort((a, b) => (a.completedAt?.getTime() || 0) - (b.completedAt?.getTime() || 0));

    while (tasks.length > this.config.maxTaskHistory) {
      const oldest = tasks.shift();
      if (oldest) {
        this.tasks.delete(oldest.id);
        this.emit('taskCleaned', oldest);
      }
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    this.cleanupTimer.unref(); // Don't prevent process exit
  }

  /**
   * Stop the cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.removeAllListeners();
  }

  /**
   * Create a subtask
   */
  createSubtask(
    parentTaskId: string,
    type: string,
    payload: Record<string, unknown>,
    options: {
      dependencies?: string[];
      maxRetries?: number;
      timeoutMs?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): Task | null {
    const parent = this.tasks.get(parentTaskId);
    if (!parent) return null;

    return this.createTask(type, payload, {
      ...options,
      parentTaskId,
      dependencies: [...(options.dependencies || [])],
    });
  }

  /**
   * Get all subtasks of a task
   */
  getSubtasks(parentTaskId: string): Task[] {
    return this.getTasks({ parentTaskId });
  }
}

// Singleton instance
let taskManagerInstance: TaskManager | null = null;

export function getTaskManager(config?: Partial<TaskManagerConfig>): TaskManager {
  if (!taskManagerInstance) {
    taskManagerInstance = new TaskManager(config);
  }
  return taskManagerInstance;
}

export function resetTaskManager(): void {
  if (taskManagerInstance) {
    taskManagerInstance.destroy();
    taskManagerInstance = null;
  }
}
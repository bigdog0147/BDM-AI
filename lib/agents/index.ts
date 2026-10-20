/**
 * Agent Framework - Main Entry Point
 * Exports all agent framework components
 */

// Types
export type {
  TaskState,
  AgentType,
  AgentCapability,
  Permission,
  ExecutionContext,
  AgentInput,
  AgentOutput,
  Agent,
  Task,
  TaskTransition,
  MemoryEntry,
  MemoryQuery,
  ProjectContext,
  AgentRegistration,
  OrchestrationPlan,
  OrchestrationResult,
  TaskStats,
  MemoryStats,
} from './types';

// Core Components
export { PermissionManager, permissionManager } from './PermissionManager';
export { TaskManager, getTaskManager, resetTaskManager } from './TaskManager';
export { MemoryManager, getMemoryManager, resetMemoryManager } from './MemoryManager';
export { ProjectSync, createProjectSync } from './ProjectSync';
export { Dispatcher, getDispatcher, resetDispatcher } from './Dispatcher';
export { Orchestrator, getOrchestrator, resetOrchestrator } from './Orchestrator';
export { MasterAgent, getMasterAgent, resetMasterAgent, type MasterAgentRequest, type MasterAgentResponse } from './MasterAgent';

// Base Agent
export { BaseAgent, AgentRegistry, agentRegistry, registerBuiltinAgents } from './Agent';
export { PlannerAgent, ResearcherAgent, CoderAgent, AnalystAgent, ExecutorAgent } from './BuiltinAgents';

// Re-export provider types for convenience
export type {
  ProviderType,
  ModelConfig,
  ProviderConfig,
  ChatMessage,
  ToolCall,
  Tool,
  ChatCompletionOptions,
  ChatCompletionResult,
  ModelProvider,
  ChatCompletionChunk,
  ProviderError,
  ProviderRegistry,
} from '@/lib/providers/types';
export { getProvider, initializeProviders, createProvider, validateProviderConfig } from '@/lib/providers';
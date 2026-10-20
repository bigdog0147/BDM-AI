/**
 * Planner Agent
 * Creates execution plans for complex tasks
 */

import type {
  AgentType,
  AgentCapability,
  AgentInput,
  AgentOutput,
  Permission,
  ExecutionContext,
} from './types';
import { BaseAgent } from './Agent';

export class PlannerAgent extends BaseAgent {
  readonly type: AgentType = 'planner';
  readonly name = 'Task Planner';
  readonly description = 'Creates structured execution plans for complex tasks';
  readonly capabilities: AgentCapability[] = [
    {
      name: 'plan',
      description: 'Create a step-by-step execution plan',
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string' },
          context: { type: 'object' },
          constraints: { type: 'array', items: { type: 'string' } },
        },
        required: ['goal'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                description: { type: 'string' },
                dependencies: { type: 'array', items: { type: 'string' } },
                estimatedDurationMs: { type: 'number' },
              },
            },
          },
        },
      },
      requiredPermissions: [
        { resource: 'memory', action: 'read', scope: 'project:*' },
        { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'plan' } },
        { resource: 'project', action: 'read', scope: 'project:*' },
      ],
    },
    {
      name: 'decompose',
      description: 'Break down a complex task into subtasks',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string' },
          maxDepth: { type: 'number' },
        },
        required: ['task'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      requiredPermissions: [
        { resource: 'memory', action: 'read', scope: 'project:*' },
      ],
    },
  ];

  readonly requiredPermissions: Permission[] = [
    { resource: 'memory', action: 'read', scope: 'project:*' },
    { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'plan' } },
    { resource: 'project', action: 'read', scope: 'project:*' },
  ];

  async execute(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const { taskId, payload, context } = input;

    // Validate permissions
    const permCheck = this.validatePermissions(context);
    if (!permCheck.allowed) {
      return this.createOutput(taskId, false, undefined, `Missing permissions: ${permCheck.missing.map(p => `${p.resource}:${p.action}`).join(', ')}`, {
        durationMs: Date.now() - startTime,
      });
    }

    const { goal, context: taskContext, constraints } = payload as {
      goal: string;
      context?: Record<string, unknown>;
      constraints?: string[];
    };

    if (!goal) {
      return this.createOutput(taskId, false, undefined, 'Goal is required for planning', {
        durationMs: Date.now() - startTime,
      });
    }

    try {
      const plan = await this.createPlan(goal, taskContext, constraints);
      
      return this.createOutput(taskId, true, { plan }, undefined, {
        durationMs: Date.now() - startTime,
        provider: this.provider?.type,
        model: this.config.model,
      });
    } catch (error) {
      return this.createOutput(taskId, false, undefined, error instanceof Error ? error.message : 'Planning failed', {
        durationMs: Date.now() - startTime,
      });
    }
  }

  private async createPlan(
    goal: string,
    context?: Record<string, unknown>,
    constraints?: string[]
  ): Promise<{
    steps: Array<{
      id: string;
      type: string;
      description: string;
      dependencies: string[];
      estimatedDurationMs: number;
    }>;
  }> {
    const systemPrompt = `You are a task planner. Break down the goal into specific, actionable steps.
Each step should have:
- A unique ID
- A type (research, code, analyze, execute, etc.)
- A clear description
- Dependencies (other step IDs that must complete first)
- Estimated duration in milliseconds

Return a JSON object with a "steps" array.`;

    const userPrompt = `Goal: ${goal}

${context ? `Context: ${JSON.stringify(context)}` : ''}
${constraints?.length ? `Constraints: ${constraints.join(', ')}` : ''}

Create an execution plan.`;

    const result = await this.callModelJson<{
      steps: Array<{
        id: string;
        type: string;
        description: string;
        dependencies: string[];
        estimatedDurationMs: number;
      }>;
    }>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                description: { type: 'string' },
                dependencies: { type: 'array', items: { type: 'string' } },
                estimatedDurationMs: { type: 'number' },
              },
              required: ['id', 'type', 'description', 'dependencies', 'estimatedDurationMs'],
            },
          },
        },
        required: ['steps'],
      }
    );

    return result;
  }
}

/**
 * Researcher Agent
 * Gathers information from various sources
 */

export class ResearcherAgent extends BaseAgent {
  readonly type: AgentType = 'researcher';
  readonly name = 'Researcher';
  readonly description = 'Gathers and synthesizes information from web and local sources';
  readonly capabilities: AgentCapability[] = [
    {
      name: 'research',
      description: 'Research a topic and return synthesized findings',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
          depth: { type: 'string', enum: ['shallow', 'medium', 'deep'] },
        },
        required: ['query'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          findings: { type: 'array', items: { type: 'object' } },
          sources: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
      },
      requiredPermissions: [
        { resource: 'network', action: 'read', scope: 'https:*' },
        { resource: 'memory', action: 'read', scope: 'project:*' },
        { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'fact' } },
        { resource: 'project', action: 'read', scope: 'project:*' },
      ],
    },
    {
      name: 'search',
      description: 'Search for specific information',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          results: { type: 'array', items: { type: 'object' } },
        },
      },
      requiredPermissions: [
        { resource: 'network', action: 'read', scope: 'https:*' },
      ],
    },
  ];

  readonly requiredPermissions: Permission[] = [
    { resource: 'network', action: 'read', scope: 'https:*' },
    { resource: 'memory', action: 'read', scope: 'project:*' },
    { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'fact' } },
    { resource: 'project', action: 'read', scope: 'project:*' },
  ];

  async execute(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const { taskId, payload, context } = input;

    const permCheck = this.validatePermissions(context);
    if (!permCheck.allowed) {
      return this.createOutput(taskId, false, undefined, `Missing permissions: ${permCheck.missing.map(p => `${p.resource}:${p.action}`).join(', ')}`, {
        durationMs: Date.now() - startTime,
      });
    }

    const { query, sources, depth = 'medium' } = payload as {
      query: string;
      sources?: string[];
      depth?: 'shallow' | 'medium' | 'deep';
    };

    try {
      const findings = await this.research(query, depth, sources);
      
      return this.createOutput(taskId, true, { findings, summary: this.summarizeFindings(findings) }, undefined, {
        durationMs: Date.now() - startTime,
        provider: this.provider?.type,
        model: this.config.model,
      });
    } catch (error) {
      return this.createOutput(taskId, false, undefined, error instanceof Error ? error.message : 'Research failed', {
        durationMs: Date.now() - startTime,
      });
    }
  }

  private async research(
    query: string,
    depth: 'shallow' | 'medium' | 'deep',
    sources?: string[]
  ): Promise<Array<{ source: string; content: string; relevance: number }>> {
    const systemPrompt = `You are a researcher. Provide accurate, well-sourced information.
Return a JSON object with a "findings" array where each finding has:
- source: the source name/URL
- content: the key information found
- relevance: a score from 0-1

Depth: ${depth} - ${depth === 'shallow' ? 'Brief overview' : depth === 'medium' ? 'Balanced detail' : 'Comprehensive analysis'}`;

    const userPrompt = `Research query: ${query}
${sources?.length ? `Preferred sources: ${sources.join(', ')}` : ''}

Provide findings as JSON.`;

    const result = await this.callModelJson<{
      findings: Array<{ source: string; content: string; relevance: number }>;
    }>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        type: 'object',
        properties: {
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string' },
                content: { type: 'string' },
                relevance: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['source', 'content', 'relevance'],
            },
          },
        },
        required: ['findings'],
      }
    );

    return result.findings || [];
  }

  private summarizeFindings(findings: Array<{ source: string; content: string; relevance: number }>): string {
    if (findings.length === 0) return 'No findings available.';
    const topFindings = findings.slice(0, 3);
    return topFindings.map(f => `- ${f.source}: ${f.content.slice(0, 200)}`).join('\n');
  }
}

/**
 * Coder Agent
 * Implements code changes and creates artifacts
 */

export class CoderAgent extends BaseAgent {
  readonly type: AgentType = 'coder';
  readonly name = 'Coder';
  readonly description = 'Implements code changes, creates files, and runs tests';
  readonly capabilities: AgentCapability[] = [
    {
      name: 'implement',
      description: 'Implement a feature or fix based on requirements',
      inputSchema: {
        type: 'object',
        properties: {
          requirements: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          language: { type: 'string' },
          tests: { type: 'boolean' },
        },
        required: ['requirements'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'object' } },
          tests: { type: 'array', items: { type: 'string' } },
        },
      },
      requiredPermissions: [
        { resource: 'filesystem', action: 'read', scope: 'project:*' },
        { resource: 'filesystem', action: 'write', scope: 'project:*', conditions: { maxFileSize: 100000 } },
        { resource: 'shell', action: 'execute', scope: 'project:*', conditions: { allowedCommands: ['npm', 'npx', 'node', 'pnpm', 'yarn', 'git'] } },
        { resource: 'memory', action: 'read', scope: 'project:*' },
        { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'artifact' } },
        { resource: 'project', action: 'read', scope: 'project:*' },
      ],
    },
    {
      name: 'refactor',
      description: 'Refactor existing code',
      inputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          goals: { type: 'array', items: { type: 'string' } },
        },
        required: ['files', 'goals'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          changes: { type: 'array', items: { type: 'object' } },
        },
      },
      requiredPermissions: [
        { resource: 'filesystem', action: 'read', scope: 'project:*' },
        { resource: 'filesystem', action: 'write', scope: 'project:*' },
        { resource: 'shell', action: 'execute', scope: 'project:*', conditions: { allowedCommands: ['npm', 'npx', 'node'] } },
      ],
    },
    {
      name: 'test',
      description: 'Create and run tests',
      inputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          framework: { type: 'string' },
        },
        required: ['files'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          testFiles: { type: 'array', items: { type: 'string' } },
          results: { type: 'object' },
        },
      },
      requiredPermissions: [
        { resource: 'filesystem', action: 'read', scope: 'project:*' },
        { resource: 'filesystem', action: 'write', scope: 'project:*' },
        { resource: 'shell', action: 'execute', scope: 'project:*', conditions: { allowedCommands: ['npm', 'npx', 'node', 'vitest', 'jest'] } },
      ],
    },
  ];

  readonly requiredPermissions: Permission[] = [
    { resource: 'filesystem', action: 'read', scope: 'project:*' },
    { resource: 'filesystem', action: 'write', scope: 'project:*', conditions: { maxFileSize: 100000 } },
    { resource: 'shell', action: 'execute', scope: 'project:*', conditions: { allowedCommands: ['npm', 'npx', 'node', 'pnpm', 'yarn', 'git'] } },
    { resource: 'memory', action: 'read', scope: 'project:*' },
    { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'artifact' } },
    { resource: 'project', action: 'read', scope: 'project:*' },
  ];

  async execute(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const { taskId, payload, context } = input;

    const permCheck = this.validatePermissions(context);
    if (!permCheck.allowed) {
      return this.createOutput(taskId, false, undefined, `Missing permissions: ${permCheck.missing.map(p => `${p.resource}:${p.action}`).join(', ')}`, {
        durationMs: Date.now() - startTime,
      });
    }

    const { requirements, files, language = 'typescript', tests = false } = payload as {
      requirements: string;
      files?: string[];
      language?: string;
      tests?: boolean;
    };

    try {
      // This is a simplified implementation - in practice would use ProjectSync
      const implementation = await this.implementCode(requirements, language, files);
      
      return this.createOutput(taskId, true, { implementation, files: files || [] }, undefined, {
        durationMs: Date.now() - startTime,
        provider: this.provider?.type,
        model: this.config.model,
      });
    } catch (error) {
      return this.createOutput(taskId, false, undefined, error instanceof Error ? error.message : 'Implementation failed', {
        durationMs: Date.now() - startTime,
      });
    }
  }

  private async implementCode(
    requirements: string,
    language: string,
    targetFiles?: string[]
  ): Promise<{ files: Array<{ path: string; content: string }> }> {
    const systemPrompt = `You are a code implementation agent. Write clean, production-ready code.
Language: ${language}
${targetFiles?.length ? `Target files: ${targetFiles.join(', ')}` : ''}

Return a JSON object with a "files" array where each file has:
- path: relative file path
- content: complete file content`;

    const userPrompt = `Requirements: ${requirements}

Implement the solution.`;

    const result = await this.callModelJson<{
      files: Array<{ path: string; content: string }>;
    }>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['files'],
      }
    );

    return result;
  }
}

/**
 * Analyst Agent
 * Reviews and analyzes code, architecture, and decisions
 */

export class AnalystAgent extends BaseAgent {
  readonly type: AgentType = 'analyst';
  readonly name = 'Analyst';
  readonly description = 'Analyzes code, architecture, and decisions for quality and correctness';
  readonly capabilities: AgentCapability[] = [
    {
      name: 'analyze',
      description: 'Analyze code or architecture for issues',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          type: { type: 'string', enum: ['code', 'architecture', 'security', 'performance'] },
          criteria: { type: 'array', items: { type: 'string' } },
        },
        required: ['target', 'type'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          issues: { type: 'array', items: { type: 'object' } },
          recommendations: { type: 'array', items: { type: 'string' } },
          score: { type: 'number' },
        },
      },
      requiredPermissions: [
        { resource: 'filesystem', action: 'read', scope: 'project:*' },
        { resource: 'memory', action: 'read', scope: 'project:*' },
        { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'decision' } },
        { resource: 'project', action: 'read', scope: 'project:*' },
      ],
    },
    {
      name: 'review',
      description: 'Review a pull request or change set',
      inputSchema: {
        type: 'object',
        properties: {
          changes: { type: 'array', items: { type: 'object' } },
          context: { type: 'object' },
        },
        required: ['changes'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          comments: { type: 'array', items: { type: 'object' } },
          approved: { type: 'boolean' },
        },
      },
      requiredPermissions: [
        { resource: 'filesystem', action: 'read', scope: 'project:*' },
        { resource: 'memory', action: 'read', scope: 'project:*' },
      ],
    },
  ];

  readonly requiredPermissions: Permission[] = [
    { resource: 'filesystem', action: 'read', scope: 'project:*' },
    { resource: 'memory', action: 'read', scope: 'project:*' },
    { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'decision' } },
    { resource: 'project', action: 'read', scope: 'project:*' },
  ];

  async execute(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const { taskId, payload, context } = input;

    const permCheck = this.validatePermissions(context);
    if (!permCheck.allowed) {
      return this.createOutput(taskId, false, undefined, `Missing permissions: ${permCheck.missing.map(p => `${p.resource}:${p.action}`).join(', ')}`, {
        durationMs: Date.now() - startTime,
      });
    }

    const { target, type, criteria } = payload as {
      target: string;
      type: 'code' | 'architecture' | 'security' | 'performance';
      criteria?: string[];
    };

    try {
      const analysis = await this.analyze(target, type, criteria);
      
      return this.createOutput(taskId, true, analysis, undefined, {
        durationMs: Date.now() - startTime,
        provider: this.provider?.type,
        model: this.config.model,
      });
    } catch (error) {
      return this.createOutput(taskId, false, undefined, error instanceof Error ? error.message : 'Analysis failed', {
        durationMs: Date.now() - startTime,
      });
    }
  }

  private async analyze(
    target: string,
    type: 'code' | 'architecture' | 'security' | 'performance',
    criteria?: string[]
  ): Promise<{
    issues: Array<{ severity: string; message: string; location?: string }>;
    recommendations: string[];
    score: number;
  }> {
    const systemPrompt = `You are a code/architecture analyst. Perform a thorough ${type} analysis.
Return a JSON object with:
- issues: array of {severity, message, location?}
- recommendations: array of strings
- score: overall quality score 0-100

Criteria: ${criteria?.join(', ') || 'General best practices'}`;

    const userPrompt = `Analyze: ${target}`;

    const result = await this.callModelJson<{
      issues: Array<{ severity: string; message: string; location?: string }>;
      recommendations: string[];
      score: number;
    }>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        type: 'object',
        properties: {
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
                message: { type: 'string' },
                location: { type: 'string' },
              },
              required: ['severity', 'message'],
            },
          },
          recommendations: { type: 'array', items: { type: 'string' } },
          score: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['issues', 'recommendations', 'score'],
      }
    );

    return result;
  }
}

/**
 * Executor Agent
 * Runs commands and executes operations
 */

export class ExecutorAgent extends BaseAgent {
  readonly type: AgentType = 'executor';
  readonly name = 'Executor';
  readonly description = 'Executes commands, runs scripts, and performs operations';
  readonly capabilities: AgentCapability[] = [
    {
      name: 'execute',
      description: 'Execute a command or script',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          cwd: { type: 'string' },
          env: { type: 'object' },
          timeout: { type: 'number' },
        },
        required: ['command'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'number' },
        },
      },
      requiredPermissions: [
        { resource: 'shell', action: 'execute', scope: 'project:*', conditions: { allowedCommands: ['npm', 'node', 'bash', 'sh'] } },
        { resource: 'filesystem', action: 'read', scope: 'project:*' },
        { resource: 'project', action: 'read', scope: 'project:*' },
      ],
    },
    {
      name: 'run-script',
      description: 'Run an npm script or similar',
      inputSchema: {
        type: 'object',
        properties: {
          script: { type: 'string' },
          packageManager: { type: 'string', enum: ['npm', 'yarn', 'pnpm'] },
        },
        required: ['script'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          output: { type: 'string' },
        },
      },
      requiredPermissions: [
        { resource: 'shell', action: 'execute', scope: 'project:*', conditions: { allowedCommands: ['npm', 'npx', 'node', 'pnpm', 'yarn'] } },
      ],
    },
  ];

  readonly requiredPermissions: Permission[] = [
    { resource: 'shell', action: 'execute', scope: 'project:*', conditions: { allowedCommands: ['npm', 'node', 'bash', 'sh'] } },
    { resource: 'filesystem', action: 'read', scope: 'project:*' },
    { resource: 'project', action: 'read', scope: 'project:*' },
  ];

  async execute(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const { taskId, payload, context } = input;

    const permCheck = this.validatePermissions(context);
    if (!permCheck.allowed) {
      return this.createOutput(taskId, false, undefined, `Missing permissions: ${permCheck.missing.map(p => `${p.resource}:${p.action}`).join(', ')}`, {
        durationMs: Date.now() - startTime,
      });
    }

    const { command, args = [], cwd, env = {}, timeout = 60000 } = payload as {
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
    };

    // Validate command is allowed
    if (!this.isCommandAllowed(command, context)) {
      return this.createOutput(taskId, false, undefined, `Command not allowed: ${command}`, {
        durationMs: Date.now() - startTime,
      });
    }

    try {
      const result = await this.runCommand(command, args, cwd || context.workingDirectory, { ...context.environment, ...env }, timeout);
      
      return this.createOutput(taskId, result.exitCode === 0, result, result.exitCode !== 0 ? `Command exited with code ${result.exitCode}` : undefined, {
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      return this.createOutput(taskId, false, undefined, error instanceof Error ? error.message : 'Execution failed', {
        durationMs: Date.now() - startTime,
      });
    }
  }

  private isCommandAllowed(command: string, context: ExecutionContext): boolean {
    const allowedCommands = context.permissions
      .filter(p => p.resource === 'shell' && p.action === 'execute')
      .flatMap(p => p.conditions?.allowedCommands as string[] || []);

    if (allowedCommands.includes('*')) return true;
    if (allowedCommands.length === 0) return false;

    const baseCommand = command.split(' ')[0];
    return allowedCommands.some(allowed => baseCommand === allowed || baseCommand.endsWith(`/${allowed}`));
  }

  private async runCommand(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // This would use child_process in real implementation
    // For now, return a mock result
    return {
      stdout: `Executed: ${command} ${args.join(' ')}`,
      stderr: '',
      exitCode: 0,
    };
  }
}
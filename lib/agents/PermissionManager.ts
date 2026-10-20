/**
 * Permission Manager
 * Centralized authorization for agent operations
 */

import type { Permission, AgentType } from './types';

export class PermissionManager {
  private static instance: PermissionManager;
  private agentPermissions: Map<AgentType, Permission[]> = new Map();
  private globalPermissions: Permission[] = [];
  private defaultDeny = true;

  private constructor() {
    this.initializeDefaultPermissions();
  }

  static getInstance(): PermissionManager {
    if (!PermissionManager.instance) {
      PermissionManager.instance = new PermissionManager();
    }
    return PermissionManager.instance;
  }

  private initializeDefaultPermissions(): void {
    // Default permissions for each agent type
    this.agentPermissions.set('planner', [
      { resource: 'memory', action: 'read', scope: 'project:*' },
      { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'plan' } },
      { resource: 'project', action: 'read', scope: 'project:*' },
    ]);

    this.agentPermissions.set('researcher', [
      { resource: 'network', action: 'read', scope: 'https:*' },
      { resource: 'memory', action: 'read', scope: 'project:*' },
      { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'fact' } },
      { resource: 'project', action: 'read', scope: 'project:*' },
    ]);

    this.agentPermissions.set('coder', [
      { resource: 'filesystem', action: 'read', scope: 'project:*' },
      { resource: 'filesystem', action: 'write', scope: 'project:*', conditions: { maxFileSize: 100000 } },
      { resource: 'shell', action: 'execute', scope: 'project:*', conditions: { allowedCommands: ['npm', 'npx', 'node', 'pnpm', 'yarn', 'git'] } },
      { resource: 'memory', action: 'read', scope: 'project:*' },
      { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'artifact' } },
      { resource: 'project', action: 'read', scope: 'project:*' },
    ]);

    this.agentPermissions.set('analyst', [
      { resource: 'filesystem', action: 'read', scope: 'project:*' },
      { resource: 'memory', action: 'read', scope: 'project:*' },
      { resource: 'memory', action: 'write', scope: 'project:*', conditions: { type: 'decision' } },
      { resource: 'project', action: 'read', scope: 'project:*' },
    ]);

    this.agentPermissions.set('executor', [
      { resource: 'shell', action: 'execute', scope: 'project:*', conditions: { allowedCommands: ['npm', 'node', 'bash', 'sh'] } },
      { resource: 'filesystem', action: 'read', scope: 'project:*' },
      { resource: 'memory', action: 'read', scope: 'project:*' },
      { resource: 'project', action: 'read', scope: 'project:*' },
    ]);

    // Global deny-all for high-impact actions
    this.globalPermissions = [
      { resource: 'filesystem', action: 'delete', scope: '*' },
      { resource: 'shell', action: 'execute', scope: '*' },
      { resource: 'network', action: 'write', scope: '*' },
      { resource: 'database', action: 'admin', scope: '*' },
      { resource: 'provider', action: 'admin', scope: '*' },
    ];
  }

  /**
   * Check if an agent has a specific permission
   */
  checkPermission(
    agentType: AgentType,
    permission: Permission,
    context?: { projectId?: string; resourcePath?: string }
  ): boolean {
    const agentPerms = this.agentPermissions.get(agentType) || [];

    // Check explicit agent permissions
    for (const agentPerm of agentPerms) {
      if (this.permissionMatches(agentPerm, permission, context)) {
        // Check if globally denied
        if (this.isGloballyDenied(permission)) {
          return false;
        }
        return true;
      }
    }

    // Default deny
    return false;
  }

  /**
   * Check multiple permissions at once
   */
  checkPermissions(
    agentType: AgentType,
    permissions: Permission[],
    context?: { projectId?: string; resourcePath?: string }
  ): { allowed: Permission[]; denied: Permission[] } {
    const allowed: Permission[] = [];
    const denied: Permission[] = [];

    for (const perm of permissions) {
      if (this.checkPermission(agentType, perm, context)) {
        allowed.push(perm);
      } else {
        denied.push(perm);
      }
    }

    return { allowed, denied };
  }

  /**
   * Grant a permission to an agent type
   */
  grantPermission(agentType: AgentType, permission: Permission): void {
    const perms = this.agentPermissions.get(agentType) || [];
    // Check if already exists
    if (!perms.some(p => this.permissionsEqual(p, permission))) {
      perms.push(permission);
      this.agentPermissions.set(agentType, perms);
    }
  }

  /**
   * Revoke a permission from an agent type
   */
  revokePermission(agentType: AgentType, permission: Permission): void {
    const perms = this.agentPermissions.get(agentType) || [];
    const filtered = perms.filter(p => !this.permissionsEqual(p, permission));
    this.agentPermissions.set(agentType, filtered);
  }

  /**
   * Get all permissions for an agent type
   */
  getAgentPermissions(agentType: AgentType): Permission[] {
    return [...(this.agentPermissions.get(agentType) || [])];
  }

  /**
   * Check if a file path is within allowed paths
   */
  checkFileAccess(
    agentType: AgentType,
    filePath: string,
    action: 'read' | 'write' | 'delete',
    projectRoot: string
  ): boolean {
    const normalizedPath = this.normalizePath(filePath, projectRoot);
    
    // Prevent directory traversal
    if (normalizedPath.startsWith('..') || normalizedPath.includes('..')) {
      return false;
    }

    const permission: Permission = {
      resource: 'filesystem',
      action,
      scope: `project:${normalizedPath}`,
    };

    return this.checkPermission(agentType, permission, { projectId: projectRoot, resourcePath: normalizedPath });
  }

  /**
   * Check if a shell command is allowed
   */
  checkShellCommand(
    agentType: AgentType,
    command: string,
    projectRoot: string
  ): boolean {
    const permission: Permission = {
      resource: 'shell',
      action: 'execute',
      scope: `project:${command}`,
    };

    return this.checkPermission(agentType, permission, { projectId: projectRoot });
  }

  /**
   * Check network access
   */
  checkNetworkAccess(
    agentType: AgentType,
    url: string,
    action: 'read' | 'write'
  ): boolean {
    try {
      const parsed = new URL(url);
      const scope = `${parsed.protocol}//${parsed.hostname}`;
      
      const permission: Permission = {
        resource: 'network',
        action,
        scope,
      };

      return this.checkPermission(agentType, permission);
    } catch {
      return false;
    }
  }

  /**
   * Check provider access
   */
  checkProviderAccess(
    agentType: AgentType,
    provider: 'openai' | 'ollama',
    action: 'read' | 'write' | 'admin'
  ): boolean {
    const permission: Permission = {
      resource: 'provider',
      action,
      scope: `provider:${provider}`,
    };

    return this.checkPermission(agentType, permission);
  }

  /**
   * Check database access
   */
  checkDatabaseAccess(
    agentType: AgentType,
    action: 'read' | 'write' | 'admin',
    table?: string
  ): boolean {
    const scope = table ? `database:${table}` : 'database:*';
    
    const permission: Permission = {
      resource: 'database',
      action,
      scope,
    };

    return this.checkPermission(agentType, permission);
  }

  /**
   * Validate an agent's required permissions against the system
   */
  validateAgentPermissions(agentType: AgentType, requiredPermissions: Permission[]): {
    valid: boolean;
    missing: Permission[];
  } {
    const agentPerms = this.agentPermissions.get(agentType) || [];
    const missing = requiredPermissions.filter(reqPerm => 
      !agentPerms.some(agentPerm => this.permissionsEqual(agentPerm, reqPerm))
    );

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  private permissionMatches(
    agentPerm: Permission,
    requestedPerm: Permission,
    context?: { projectId?: string; resourcePath?: string }
  ): boolean {
    // Resource must match
    if (agentPerm.resource !== requestedPerm.resource) return false;

    // Action must match or be broader (admin > write > read)
    const actionHierarchy: Record<string, number> = { read: 1, write: 2, execute: 3, delete: 4, admin: 5 };
    if ((actionHierarchy[agentPerm.action] || 0) < (actionHierarchy[requestedPerm.action] || 0)) {
      return false;
    }

    // Scope matching
    if (agentPerm.scope && requestedPerm.scope) {
      if (!this.scopeMatches(agentPerm.scope, requestedPerm.scope, context)) {
        return false;
      }
    }

    // Conditions matching
    if (agentPerm.conditions && requestedPerm.conditions) {
      for (const [key, value] of Object.entries(requestedPerm.conditions)) {
        if (agentPerm.conditions[key] !== value) return false;
      }
    }

    return true;
  }

  private scopeMatches(
    agentScope: string,
    requestedScope: string,
    context?: { projectId?: string; resourcePath?: string }
  ): boolean {
    // Exact match
    if (agentScope === requestedScope) return true;

    // Wildcard matching
    if (agentScope.endsWith('*')) {
      const prefix = agentScope.slice(0, -1);
      if (requestedScope.startsWith(prefix)) return true;
    }

    // Project scope with context
    if (context?.projectId && agentScope === 'project:*') {
      return requestedScope.startsWith(`project:${context.projectId}`);
    }

    return false;
  }

  private isGloballyDenied(permission: Permission): boolean {
    return this.globalPermissions.some(global => 
      this.permissionMatches(global, permission)
    );
  }

  private permissionsEqual(a: Permission, b: Permission): boolean {
    return a.resource === b.resource &&
           a.action === b.action &&
           a.scope === b.scope &&
           JSON.stringify(a.conditions || {}) === JSON.stringify(b.conditions || {});
  }

  private normalizePath(filePath: string, projectRoot: string): string {
    // Resolve relative to project root
    const path = require('path');
    const absolutePath = path.resolve(projectRoot, filePath);
    const relativePath = path.relative(projectRoot, absolutePath);
    return relativePath.replace(/\\/g, '/');
  }

  /**
   * Reset to default permissions (for testing)
   */
  reset(): void {
    this.agentPermissions.clear();
    this.initializeDefaultPermissions();
  }
}

export const permissionManager = PermissionManager.getInstance();
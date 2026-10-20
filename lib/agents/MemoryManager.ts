/**
 * Memory Manager
 * Handles persistent and temporary memory for agents
 */

import type { MemoryEntry, MemoryQuery, ProjectContext, MemoryStats } from './types';

export interface MemoryManagerConfig {
  maxEntriesPerProject: number;
  defaultRetentionDays: number;
  maxEntrySize: number;
  enableSemanticSearch: boolean;
}

const DEFAULT_CONFIG: MemoryManagerConfig = {
  maxEntriesPerProject: 10000,
  defaultRetentionDays: 30,
  maxEntrySize: 100000, // 100KB
  enableSemanticSearch: false,
};

interface MemoryStore {
  entries: Map<string, MemoryEntry>;
  projectContexts: Map<string, ProjectContext>;
}

export class MemoryManager {
  private store: MemoryStore = {
    entries: new Map(),
    projectContexts: new Map(),
  };
  private config: MemoryManagerConfig;

  constructor(config: Partial<MemoryManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a new project context
   */
  createProjectContext(context: Omit<ProjectContext, 'id' | 'createdAt' | 'updatedAt'>): ProjectContext {
    const now = new Date();
    const projectContext: ProjectContext = {
      ...context,
      id: `project_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: now,
      updatedAt: now,
    };

    this.store.projectContexts.set(projectContext.id, projectContext);
    return projectContext;
  }

  /**
   * Get project context
   */
  getProjectContext(projectId: string): ProjectContext | undefined {
    return this.store.projectContexts.get(projectId);
  }

  /**
   * Update project context
   */
  updateProjectContext(projectId: string, updates: Partial<ProjectContext>): ProjectContext | null {
    const context = this.store.projectContexts.get(projectId);
    if (!context) return null;

    const updated = { ...context, ...updates, updatedAt: new Date() };
    this.store.projectContexts.set(projectId, updated);
    return updated;
  }

  /**
   * Store a memory entry
   */
  storeMemory(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>): MemoryEntry {
    const now = new Date();
    const memoryEntry: MemoryEntry = {
      ...entry,
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    };

    // Validate entry size
    const entrySize = JSON.stringify(memoryEntry.content).length;
    if (entrySize > this.config.maxEntrySize) {
      throw new Error(`Memory entry exceeds max size of ${this.config.maxEntrySize} bytes`);
    }

    // Check project limits
    const projectEntries = this.getProjectEntryCount(entry.projectId);
    if (projectEntries >= this.config.maxEntriesPerProject) {
      this.evictOldestEntries(entry.projectId);
    }

    this.store.entries.set(memoryEntry.id, memoryEntry);
    return memoryEntry;
  }

  /**
   * Get a memory entry by ID
   */
  getMemory(entryId: string): MemoryEntry | undefined {
    const entry = this.store.entries.get(entryId);
    if (entry) {
      entry.accessCount++;
      entry.updatedAt = new Date();
    }
    return entry;
  }

  /**
   * Query memory entries
   */
  queryMemory(query: MemoryQuery): MemoryEntry[] {
    let results = Array.from(this.store.entries.values())
      .filter(e => e.projectId === query.projectId);

    if (query.scope) {
      results = results.filter(e => e.scope === query.scope);
    }

    if (query.type) {
      results = results.filter(e => e.type === query.type);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter(e => 
        query.tags!.some(tag => e.tags.includes(tag))
      );
    }

    // Filter expired entries
    const now = new Date();
    results = results.filter(e => !e.expiresAt || e.expiresAt > now);

    // Sort by relevance (access count + recency)
    results.sort((a, b) => {
      const scoreA = a.accessCount * 0.5 + (Date.now() - a.updatedAt.getTime()) * -0.0001;
      const scoreB = b.accessCount * 0.5 + (Date.now() - b.updatedAt.getTime()) * -0.0001;
      return scoreB - scoreA;
    });

    const offset = query.offset || 0;
    const limit = query.limit || 50;
    return results.slice(offset, offset + limit);
  }

  /**
   * Update a memory entry
   */
  updateMemory(entryId: string, updates: Partial<Omit<MemoryEntry, 'id' | 'projectId' | 'createdAt'>>): MemoryEntry | null {
    const entry = this.store.entries.get(entryId);
    if (!entry) return null;

    const updated = { ...entry, ...updates, updatedAt: new Date() };
    
    // Validate size if content updated
    if (updates.content) {
      const entrySize = JSON.stringify(updated.content).length;
      if (entrySize > this.config.maxEntrySize) {
        throw new Error(`Memory entry exceeds max size of ${this.config.maxEntrySize} bytes`);
      }
    }

    this.store.entries.set(entryId, updated);
    return updated;
  }

  /**
   * Delete a memory entry
   */
  deleteMemory(entryId: string): boolean {
    return this.store.entries.delete(entryId);
  }

  /**
   * Delete all memory entries for a project
   */
  deleteProjectMemory(projectId: string): number {
    let count = 0;
    for (const [id, entry] of this.store.entries.entries()) {
      if (entry.projectId === projectId) {
        this.store.entries.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get memory statistics for a project
   */
  getProjectStats(projectId: string): MemoryStats {
    const entries = Array.from(this.store.entries.values())
      .filter(e => e.projectId === projectId);

    const byType: Record<string, number> = {};
    const byScope: Record<string, number> = {};
    let totalSize = 0;
    let oldest: Date | undefined;
    let newest: Date | undefined;

    for (const entry of entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      byScope[entry.scope] = (byScope[entry.scope] || 0) + 1;
      totalSize += JSON.stringify(entry.content).length;
      
      if (!oldest || entry.createdAt < oldest) oldest = entry.createdAt;
      if (!newest || entry.createdAt > newest) newest = entry.createdAt;
    }

    return {
      totalEntries: entries.length,
      byType,
      byScope,
      totalSize,
      oldestEntry: oldest,
      newestEntry: newest,
    };
  }

  /**
   * Clean up expired entries
   */
  cleanupExpired(): number {
    const now = new Date();
    let count = 0;

    for (const [id, entry] of this.store.entries.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.store.entries.delete(id);
        count++;
      }
    }

    return count;
  }

  /**
   * Enforce retention policy
   */
  enforceRetention(projectId: string, retentionDays?: number): number {
    const days = retentionDays || this.config.defaultRetentionDays;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let count = 0;

    for (const [id, entry] of this.store.entries.entries()) {
      if (entry.projectId === projectId && entry.createdAt < cutoff) {
        // Don't delete pinned/important entries
        if (entry.tags.includes('pinned') || entry.tags.includes('important')) continue;
        this.store.entries.delete(id);
        count++;
      }
    }

    return count;
  }

  private getProjectEntryCount(projectId: string): number {
    let count = 0;
    for (const entry of this.store.entries.values()) {
      if (entry.projectId === projectId) count++;
    }
    return count;
  }

  private evictOldestEntries(projectId: string, count: number = 100): void {
    const entries = Array.from(this.store.entries.values())
      .filter(e => e.projectId === projectId)
      .filter(e => !e.tags.includes('pinned') && !e.tags.includes('important'))
      .sort((a, b) => a.accessCount - b.accessCount || a.createdAt.getTime() - b.createdAt.getTime());

    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.store.entries.delete(entries[i].id);
    }
  }

  /**
   * Export project memory for backup
   */
  exportProjectMemory(projectId: string): MemoryEntry[] {
    return Array.from(this.store.entries.values())
      .filter(e => e.projectId === projectId);
  }

  /**
   * Import project memory from backup
   */
  importProjectMemory(projectId: string, entries: MemoryEntry[]): number {
    let imported = 0;
    for (const entry of entries) {
      if (entry.projectId === projectId) {
        this.store.entries.set(entry.id, entry);
        imported++;
      }
    }
    return imported;
  }

  /**
   * Clear all memory (for testing)
   */
  clear(): void {
    this.store.entries.clear();
    this.store.projectContexts.clear();
  }
}

// Singleton instance
let memoryManagerInstance: MemoryManager | null = null;

export function getMemoryManager(config?: Partial<MemoryManagerConfig>): MemoryManager {
  if (!memoryManagerInstance) {
    memoryManagerInstance = new MemoryManager(config);
  }
  return memoryManagerInstance;
}

export function resetMemoryManager(): void {
  memoryManagerInstance = null;
}
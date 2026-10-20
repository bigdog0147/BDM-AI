/**
 * Project Sync
 * Handles project context synchronization and file access
 */

import type { ProjectContext } from './types';
import { getMemoryManager } from './MemoryManager';

export interface FileEntry {
  path: string;
  content: string;
  size: number;
  modifiedAt: Date;
  isDirectory: boolean;
  mimeType?: string;
}

export interface SyncOptions {
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFileSize?: number;
  followSymlinks?: boolean;
}

export interface SyncResult {
  projectId: string;
  files: FileEntry[];
  errors: Array<{ path: string; error: string }>;
  stats: {
    totalFiles: number;
    totalSize: number;
    durationMs: number;
  };
}

const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  '.next/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '*.log',
  '*.tmp',
  '.env*',
  '*.pem',
  '*.key',
  '*.crt',
  '*.p12',
  '.DS_Store',
  'Thumbs.db',
];

export class ProjectSync {
  private projectContext: ProjectContext;
  private memoryManager = getMemoryManager();

  constructor(projectContext: ProjectContext) {
    this.projectContext = projectContext;
  }

  /**
   * Get the project context
   */
  getContext(): ProjectContext {
    return this.projectContext;
  }

  /**
   * Validate a file path is within project boundaries
   */
  validatePath(filePath: string): { valid: boolean; normalizedPath: string; error?: string } {
    const path = require('path');
    const fs = require('fs');

    try {
      // Resolve to absolute path
      const absolutePath = path.resolve(this.projectContext.rootPath, filePath);
      const relativePath = path.relative(this.projectContext.rootPath, absolutePath);

      // Check for directory traversal
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return { valid: false, normalizedPath: '', error: 'Path traversal detected' };
      }

      // Check against allowed paths
      if (this.projectContext.settings.allowedPaths.length > 0) {
        const allowed = this.projectContext.settings.allowedPaths.some(allowedPath => {
          const allowedAbs = path.resolve(this.projectContext.rootPath, allowedPath);
          return absolutePath.startsWith(allowedAbs);
        });
        if (!allowed) {
          return { valid: false, normalizedPath: relativePath, error: 'Path not in allowed list' };
        }
      }

      // Check against excluded paths
      const excluded = this.projectContext.settings.excludedPaths.some(excludedPath => {
        const excludedAbs = path.resolve(this.projectContext.rootPath, excludedPath);
        return absolutePath.startsWith(excludedAbs);
      });
      if (excluded) {
        return { valid: false, normalizedPath: relativePath, error: 'Path is excluded' };
      }

      return { valid: true, normalizedPath: relativePath };
    } catch (error) {
      return { valid: false, normalizedPath: '', error: error instanceof Error ? error.message : 'Invalid path' };
    }
  }

  /**
   * Read a file from the project
   */
  readFile(filePath: string): { content: string; mimeType?: string } | null {
    const fs = require('fs');
    const path = require('path');

    const validation = this.validatePath(filePath);
    if (!validation.valid) {
      throw new Error(`File access denied: ${validation.error}`);
    }

    const absolutePath = path.resolve(this.projectContext.rootPath, validation.normalizedPath);

    try {
      const stats = fs.statSync(absolutePath);
      if (stats.isDirectory()) {
        throw new Error('Path is a directory');
      }

      if (stats.size > this.projectContext.settings.maxFileSize) {
        throw new Error(`File size exceeds limit of ${this.projectContext.settings.maxFileSize} bytes`);
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');
      const mimeType = this.getMimeType(path.extname(absolutePath));

      return { content, mimeType };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Write a file to the project
   */
  writeFile(filePath: string, content: string): { success: boolean; error?: string } {
    const fs = require('fs');
    const path = require('path');

    const validation = this.validatePath(filePath);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const absolutePath = path.resolve(this.projectContext.rootPath, validation.normalizedPath);

    try {
      // Ensure directory exists
      const dir = path.dirname(absolutePath);
      fs.mkdirSync(dir, { recursive: true });

      // Check file size
      if (Buffer.byteLength(content, 'utf-8') > this.projectContext.settings.maxFileSize) {
        return { success: false, error: `File size exceeds limit of ${this.projectContext.settings.maxFileSize} bytes` };
      }

      fs.writeFileSync(absolutePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Write failed' };
    }
  }

  /**
   * List files in a directory
   */
  listFiles(dirPath: string = '.', options: SyncOptions = {}): FileEntry[] {
    const fs = require('fs');
    const path = require('path');

    const validation = this.validatePath(dirPath);
    if (!validation.valid) {
      throw new Error(`Directory access denied: ${validation.error}`);
    }

    const absolutePath = path.resolve(this.projectContext.rootPath, validation.normalizedPath);
    const entries: FileEntry[] = [];

    const excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...(options.excludePatterns || [])];
    const includePatterns = options.includePatterns || ['**/*'];

    const walk = (currentPath: string, relativePath: string): void => {
      try {
        const stats = fs.statSync(currentPath);
        
        // Check exclude patterns
        const shouldExclude = excludePatterns.some(pattern => this.matchPattern(relativePath, pattern));
        if (shouldExclude) return;

        // Check include patterns
        const shouldInclude = includePatterns.some(pattern => this.matchPattern(relativePath, pattern));
        if (!shouldInclude && relativePath !== '.') return;

        const entry: FileEntry = {
          path: relativePath === '.' ? '' : relativePath,
          content: '',
          size: stats.size,
          modifiedAt: stats.mtime,
          isDirectory: stats.isDirectory(),
          mimeType: stats.isDirectory() ? undefined : this.getMimeType(path.extname(currentPath)),
        };

        entries.push(entry);

        if (stats.isDirectory()) {
          const children = fs.readdirSync(currentPath);
          for (const child of children) {
            walk(path.join(currentPath, child), path.join(relativePath, child));
          }
        }
      } catch {
        // Skip unreadable entries
      }
    };

    walk(absolutePath, '.');
    return entries;
  }

  /**
   * Synchronize project files (read all allowed files)
   */
  syncProject(options: SyncOptions = {}): SyncResult {
    const startTime = Date.now();
    const errors: Array<{ path: string; error: string }> = [];
    const files: FileEntry[] = [];

    try {
      const entries = this.listFiles('.', options);

      for (const entry of entries) {
        if (!entry.isDirectory && entry.path) {
          try {
            const fileData = this.readFile(entry.path);
            if (fileData) {
              files.push({ ...entry, content: fileData.content, mimeType: fileData.mimeType });
            }
          } catch (error) {
            errors.push({ path: entry.path, error: error instanceof Error ? error.message : 'Read failed' });
          }
        }
      }
    } catch (error) {
      errors.push({ path: '.', error: error instanceof Error ? error.message : 'Sync failed' });
    }

    const durationMs = Date.now() - startTime;
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    return {
      projectId: this.projectContext.id,
      files,
      errors,
      stats: {
        totalFiles: files.length,
        totalSize,
        durationMs,
      },
    };
  }

  /**
   * Search files by content
   */
  searchFiles(query: string, options: { caseSensitive?: boolean; maxResults?: number } = {}): FileEntry[] {
    const fs = require('fs');
    const path = require('path');
    const results: FileEntry[] = [];

    const entries = this.listFiles('.', { maxFileSize: options.maxResults ? 100000 : undefined });

    for (const entry of entries) {
      if (entry.isDirectory || !entry.path) continue;
      if (results.length >= (options.maxResults || 50)) break;

      try {
        const fileData = this.readFile(entry.path);
        if (fileData && this.contentMatches(fileData.content, query, options.caseSensitive)) {
          results.push({ ...entry, content: fileData.content, mimeType: fileData.mimeType });
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  /**
   * Get project file tree structure
   */
  getFileTree(): FileEntry[] {
    return this.listFiles('.');
  }

  private matchPattern(filePath: string, pattern: string): boolean {
    // Simple glob matching
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${regexPattern}$`).test(filePath);
  }

  private contentMatches(content: string, query: string, caseSensitive = false): boolean {
    if (caseSensitive) {
      return content.includes(query);
    }
    return content.toLowerCase().includes(query.toLowerCase());
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.js': 'text/javascript',
      '.jsx': 'text/javascript',
      '.json': 'application/json',
      '.css': 'text/css',
      '.html': 'text/html',
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.py': 'text/x-python',
      '.rs': 'text/x-rust',
      '.go': 'text/x-go',
      '.java': 'text/x-java',
      '.cpp': 'text/x-cpp',
      '.c': 'text/x-c',
      '.h': 'text/x-c',
      '.yml': 'text/yaml',
      '.yaml': 'text/yaml',
      '.toml': 'text/toml',
      '.sh': 'text/x-shellscript',
      '.sql': 'text/x-sql',
    };
    return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
  }
}

/**
 * Create a ProjectSync instance for a project
 */
export function createProjectSync(projectId: string, rootPath: string, options?: Partial<ProjectContext['settings']>): ProjectSync {
  const memoryManager = getMemoryManager();
  
  let context = memoryManager.getProjectContext(projectId);
  if (!context) {
    context = memoryManager.createProjectContext({
      name: path.basename(rootPath),
      rootPath,
      settings: {
        allowedPaths: ['**/*'],
        excludedPaths: DEFAULT_EXCLUDE_PATTERNS,
        maxFileSize: 1000000, // 1MB
        allowedCommands: ['npm', 'npx', 'node', 'git'],
        memoryRetentionDays: 30,
        ...options,
      },
      metadata: {},
    });
  }

  return new ProjectSync(context);
}

const path = require('path');
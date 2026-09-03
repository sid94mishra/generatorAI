// ────────────────────────────────────────────────────────────────
// CodebaseService — Link, clone, fetch, manage project codebases
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IProjectCodebaseRepository } from '../domain/ports/index.js';
import type {
  ProjectCodebase,
  CreateCodebaseParams,
  UpdateCodebaseParams,
  CodebaseType,
  FileEntry,
  ILogger,
} from '@generatorai/shared';
import { ValidationError, GitError } from '@generatorai/shared';
import type { GitManager } from '../infrastructure/GitManager.js';
import type { ProjectService } from './ProjectService.js';

export class CodebaseService {
  constructor(
    private readonly codebaseRepo: IProjectCodebaseRepository,
    private readonly projectService: ProjectService,
    private readonly gitManager: GitManager,
    private readonly logger: ILogger,
  ) {}

  async linkCodebase(projectId: string, params: CreateCodebaseParams): Promise<ProjectCodebase> {
    // Validate project exists
    await this.projectService.getProject(projectId);

    // Check max codebases limit
    const existing = await this.codebaseRepo.getByProjectId(projectId);
    const project = await this.projectService.getProject(projectId);
    const maxCodebases = project.settings.maxCodebases ?? 10;
    if (existing.length >= maxCodebases) {
      throw new ValidationError(`Project has reached the maximum number of codebases (${maxCodebases})`);
    }

    // Check alias uniqueness
    const existingAlias = await this.codebaseRepo.getByAlias(projectId, params.alias);
    if (existingAlias) {
      throw new ValidationError(`Codebase alias "${params.alias}" already exists in this project`);
    }

    const id = randomUUID();
    const now = new Date();
    const reposDir = this.projectService.getProjectReposDir(projectId);
    const clonePath = path.join(reposDir, params.alias);

    const codebase: ProjectCodebase = {
      id,
      projectId,
      alias: params.alias,
      type: params.type,
      url: params.url,
      localPath: params.localPath,
      defaultBranch: params.defaultBranch,
      subdirectory: params.subdirectory,
      clonePath,
      status: 'pending',
      settings: params.settings ?? {},
      createdAt: now,
      updatedAt: now,
    };

    await this.codebaseRepo.create(codebase);
    this.logger.info(`[Codebase] Linked ${params.type} codebase "${params.alias}" to project ${projectId}`);

    // Trigger clone/link based on type
    if (params.type === 'git-remote') {
      // Start async clone
      void this.cloneRemoteRepo(codebase).catch((err) => {
        this.logger.error(`[Codebase] Failed to clone "${params.alias}": ${err}`);
      });
    } else if (params.type === 'git-local') {
      await this.linkLocalRepo(codebase);
    } else if (params.type === 'local-dir') {
      await this.linkLocalDir(codebase);
    }

    return this.codebaseRepo.getById(id);
  }

  async unlinkCodebase(codebaseId: string): Promise<void> {
    const codebase = await this.codebaseRepo.getById(codebaseId);

    // Clean up filesystem
    if (codebase.clonePath) {
      try {
        await fs.rm(codebase.clonePath, { recursive: true, force: true });
      } catch (err) {
        this.logger.warn(`[Codebase] Failed to clean up ${codebase.clonePath}: ${err}`);
      }
    }

    await this.codebaseRepo.delete(codebaseId);
    this.logger.info(`[Codebase] Unlinked codebase ${codebaseId}`);
  }

  async cloneRemoteRepo(codebase: ProjectCodebase): Promise<void> {
    if (!codebase.url) {
      throw new Error('Codebase URL is required for git-remote type');
    }
    if (!codebase.clonePath) {
      throw new Error('Clone path is required');
    }

    await this.codebaseRepo.updateStatus(codebase.id, 'cloning');

    try {
      await fs.mkdir(path.dirname(codebase.clonePath), { recursive: true });

      // Bare clone for remote repos
      await this.gitManager.bareClone(codebase.url, codebase.clonePath);

      await this.codebaseRepo.updateStatus(codebase.id, 'ready');
      this.logger.info(`[Codebase] Bare cloned "${codebase.alias}" from ${codebase.url}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.codebaseRepo.updateStatus(codebase.id, 'error', errMsg);
      throw err;
    }
  }

  async linkLocalRepo(codebase: ProjectCodebase): Promise<void> {
    if (!codebase.localPath) {
      throw new Error('Local path is required for git-local type');
    }

    try {
      // Verify the path exists and is a git repo
      await fs.access(path.join(codebase.localPath, '.git'));
      // Store the local path as clonePath directly (no symlink needed, worktrees reference it)
      await this.codebaseRepo.update(codebase.id, {
        clonePath: codebase.localPath,
        status: 'ready',
      });
      this.logger.info(`[Codebase] Linked local git repo "${codebase.alias}" at ${codebase.localPath}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.codebaseRepo.updateStatus(codebase.id, 'error', errMsg);
      throw new Error(`Path "${codebase.localPath}" is not a valid git repository`);
    }
  }

  async linkLocalDir(codebase: ProjectCodebase): Promise<void> {
    if (!codebase.localPath) {
      throw new Error('Local path is required for local-dir type');
    }

    try {
      await fs.access(codebase.localPath);
      await this.codebaseRepo.update(codebase.id, {
        clonePath: codebase.localPath,
        status: 'ready',
      });
      this.logger.info(`[Codebase] Linked local directory "${codebase.alias}" at ${codebase.localPath}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.codebaseRepo.updateStatus(codebase.id, 'error', errMsg);
      throw new Error(`Path "${codebase.localPath}" does not exist or is not accessible`);
    }
  }

  async fetchCodebase(codebaseId: string): Promise<void> {
    const codebase = await this.codebaseRepo.getById(codebaseId);

    if (codebase.type !== 'git-remote' && codebase.type !== 'git-local') {
      throw new Error('Fetch is only supported for git repositories');
    }

    if (!codebase.clonePath) {
      throw new Error('Codebase has no clone path');
    }

    try {
      await this.gitManager.fetchAll(codebase.clonePath);
      await this.codebaseRepo.updateStatus(codebase.id, 'ready');
      this.logger.info(`[Codebase] Fetched "${codebase.alias}"`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.codebaseRepo.updateStatus(codebase.id, 'stale', errMsg);
      throw err;
    }
  }

  async fetchAllCodebases(projectId: string): Promise<void> {
    const codebases = await this.codebaseRepo.getByProjectId(projectId);
    const gitCodebases = codebases.filter((c) => c.type === 'git-remote' || c.type === 'git-local');

    for (const codebase of gitCodebases) {
      try {
        await this.fetchCodebase(codebase.id);
      } catch (err) {
        this.logger.warn(`[Codebase] Failed to fetch "${codebase.alias}": ${err}`);
      }
    }
  }

  async getCodebaseStatus(codebaseId: string): Promise<ProjectCodebase> {
    return this.codebaseRepo.getById(codebaseId);
  }

  async listBranches(codebaseId: string): Promise<string[]> {
    const codebase = await this.codebaseRepo.getById(codebaseId);
    if (!codebase.clonePath) return [];
    return this.gitManager.getBranches(codebase.clonePath);
  }

  async updateCodebase(codebaseId: string, updates: UpdateCodebaseParams): Promise<ProjectCodebase> {
    const values: Omit<Partial<ProjectCodebase>, 'lastError'> & { lastError?: string | null } = {};
    if (updates.alias !== undefined) {
      // Re-validate alias uniqueness on rename so callers get a clean
      // ValidationError instead of a raw DB UNIQUE-constraint failure (the
      // (project_id, alias) index would otherwise reject this opaquely).
      const current = await this.codebaseRepo.getById(codebaseId);
      if (updates.alias !== current.alias) {
        const clash = await this.codebaseRepo.getByAlias(current.projectId, updates.alias);
        if (clash && clash.id !== codebaseId) {
          throw new ValidationError(`Codebase alias "${updates.alias}" already exists in this project`);
        }
      }
      values.alias = updates.alias;
    }
    if (updates.defaultBranch !== undefined) values.defaultBranch = updates.defaultBranch;
    if (updates.subdirectory !== undefined) values.subdirectory = updates.subdirectory;
    // Correcting the location clears the previous failure, so the next fetch
    // reports the new location's outcome rather than the stale error.
    if (updates.url !== undefined) {
      values.url = updates.url;
      values.status = 'pending';
      values.lastError = null;
    }
    if (updates.localPath !== undefined) {
      values.localPath = updates.localPath;
      values.status = 'pending';
      values.lastError = null;
    }
    if (updates.settings !== undefined) {
      const existing = await this.codebaseRepo.getById(codebaseId);
      values.settings = { ...existing.settings, ...updates.settings };
    }
    const saved = await this.codebaseRepo.update(codebaseId, values);
    if (updates.url === undefined && updates.localPath === undefined) return saved;

    // Re-run the link/clone step. `clonePath` is only pointed at the real
    // repository by a *successful* link, so a codebase whose first link failed
    // keeps the placeholder `<repos>/<alias>` path that nothing ever created —
    // every later fetch then ran git in a directory that does not exist and
    // failed with a baffling "spawn git ENOENT". Correcting the location has to
    // re-link, or the correction has no effect.
    try {
      if (saved.type === 'git-remote') await this.cloneRemoteRepo(saved);
      else if (saved.type === 'git-local') await this.linkLocalRepo(saved);
      else if (saved.type === 'local-dir') await this.linkLocalDir(saved);
    } catch (err) {
      // linkLocalRepo / linkLocalDir already recorded the failure on the row.
      this.logger.warn(`[Codebase] Re-link after update failed for "${saved.alias}": ${err}`);
    }
    return this.codebaseRepo.getById(codebaseId);
  }

  async getByProjectId(projectId: string): Promise<ProjectCodebase[]> {
    return this.codebaseRepo.getByProjectId(projectId);
  }

  /**
   * List files in a codebase directory with .gitignore filtering.
   * For git-remote (bare clone) codebases, uses `git ls-tree` instead of fs.readdir.
   * @param subPath - relative path within the codebase to list (empty = root)
   */
  async listCodebaseFiles(codebaseId: string, subPath = ''): Promise<FileEntry[]> {
    const codebase = await this.codebaseRepo.getById(codebaseId);
    const rootDir = codebase.clonePath || codebase.localPath;
    if (!rootDir) {
      throw new ValidationError('Codebase has no accessible path');
    }

    // git-remote codebases use bare clones — use git ls-tree instead of fs.readdir
    if (codebase.type === 'git-remote') {
      return this.listBareRepoFiles(rootDir, subPath);
    }

    // Resolve the target directory safely
    const targetDir = subPath ? path.resolve(rootDir, subPath) : rootDir;

    // Security: prevent path traversal (resolves symlinks to detect escape)
    const realRoot = await fs.realpath(rootDir);
    let realTarget: string;
    try {
      realTarget = await fs.realpath(targetDir);
    } catch {
      // Path doesn't exist yet — use logical check only
      realTarget = targetDir;
    }
    if (!realTarget.startsWith(realRoot)) {
      throw new ValidationError('Invalid path: traversal outside codebase root is not allowed');
    }

    // Load .gitignore patterns from root
    const ignorePatterns = await this.loadGitignorePatterns(rootDir);

    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const result: FileEntry[] = [];

      for (const entry of entries) {
        const relativePath = path.relative(rootDir, path.join(targetDir, entry.name));
        const normalizedPath = relativePath.split(path.sep).join('/');

        // Skip .git directory
        if (entry.name === '.git') continue;

        // Check against .gitignore patterns
        if (this.isIgnored(normalizedPath, entry.isDirectory(), ignorePatterns)) continue;

        const fileEntry: FileEntry = {
          path: normalizedPath,
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        };

        if (entry.isFile()) {
          try {
            const fileStat = await fs.stat(path.join(targetDir, entry.name));
            fileEntry.size = fileStat.size;
            fileEntry.extension = path.extname(entry.name).slice(1) || undefined;
          } catch {
            // stat failed, skip size/extension
          }
        }

        result.push(fileEntry);
      }

      // Sort: directories first, then alphabetical
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return result;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ValidationError(`Path not found: ${subPath || '/'}`);
      }
      throw err;
    }
  }

  /**
   * List files from a bare git repository using `git ls-tree`.
   */
  private async listBareRepoFiles(repoPath: string, subPath = ''): Promise<FileEntry[]> {
    try {
      const entries = await this.gitManager.lsTree(repoPath, subPath);
      const result: FileEntry[] = entries.map((e) => ({
        path: e.path,
        name: e.name,
        type: e.type === 'tree' ? ('directory' as const) : ('file' as const),
        size: e.size,
        extension: e.type === 'blob' ? path.extname(e.name).slice(1) || undefined : undefined,
      }));
      // Sort: directories first, then alphabetical
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return result;
    } catch (err) {
      if (err instanceof GitError) {
        // Not a tree object means path doesn't exist
        if (err.message.includes('not a tree') || err.message.includes('does not exist')) {
          throw new ValidationError(`Path not found: ${subPath || '/'}`);
        }
      }
      throw err;
    }
  }

  /**
   * Read the content of a file in a codebase.
   * For git-remote (bare clone) codebases, uses `git show` to read from the object store.
   */
  async getCodebaseFileContent(codebaseId: string, filePath: string): Promise<string> {
    const codebase = await this.codebaseRepo.getById(codebaseId);
    const rootDir = codebase.clonePath || codebase.localPath;
    if (!rootDir) {
      throw new ValidationError('Codebase has no accessible path');
    }

    // git-remote codebases use bare clones — read via git show
    if (codebase.type === 'git-remote') {
      try {
        return await this.gitManager.showFile(rootDir, filePath);
      } catch {
        throw new ValidationError(`File not found: ${filePath}`);
      }
    }

    const targetFile = path.resolve(rootDir, filePath);

    // Security: prevent path traversal
    if (!targetFile.startsWith(path.resolve(rootDir))) {
      throw new ValidationError('Invalid path: traversal outside codebase root is not allowed');
    }

    try {
      const content = await fs.readFile(targetFile, 'utf-8');
      return content;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ValidationError(`File not found: ${filePath}`);
      }
      throw err;
    }
  }

  /**
   * Load .gitignore patterns from the codebase root.
   */
  private async loadGitignorePatterns(rootDir: string): Promise<string[]> {
    try {
      const gitignorePath = path.join(rootDir, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      return content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    } catch {
      return [];
    }
  }

  /**
   * Simple .gitignore pattern matcher.
   */
  private isIgnored(filePath: string, isDir: boolean, patterns: string[]): boolean {
    for (const pattern of patterns) {
      let p = pattern;
      let negated = false;

      if (p.startsWith('!')) {
        negated = true;
        p = p.slice(1);
      }

      // Remove trailing slash (means dir-only)
      const dirOnly = p.endsWith('/');
      if (dirOnly) {
        p = p.slice(0, -1);
        if (!isDir) continue;
      }

      // Simple glob matching
      const matched = this.matchGlob(filePath, p);
      if (matched) {
        if (negated) return false;
        return true;
      }
    }
    return false;
  }

  /**
   * Basic glob matcher supporting * and ** patterns.
   */
  private matchGlob(filePath: string, pattern: string): boolean {
    // Direct name match (e.g., "node_modules" matches "node_modules" and "foo/node_modules")
    if (!pattern.includes('/')) {
      const parts = filePath.split('/');
      return parts.some((part) => this.matchSimpleGlob(part, pattern));
    }

    // Path-based pattern
    if (pattern.startsWith('/')) {
      return this.matchSimpleGlob(filePath, pattern.slice(1));
    }

    // Match against the full path or any suffix
    if (this.matchSimpleGlob(filePath, pattern)) return true;
    const parts = filePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (this.matchSimpleGlob(parts.slice(i).join('/'), pattern)) return true;
    }
    return false;
  }

  /**
   * Simple glob matching with * (any non-/) and ** (any including /).
   */
  private matchSimpleGlob(str: string, pattern: string): boolean {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '⬛')
      .replace(/\*/g, '[^/]*')
      .replace(/⬛/g, '.*')
      .replace(/\?/g, '[^/]');
    return new RegExp(`^${regexStr}$`).test(str);
  }
}

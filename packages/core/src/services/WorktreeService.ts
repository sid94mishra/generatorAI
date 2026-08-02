// ────────────────────────────────────────────────────────────────
// WorktreeService — Create/remove/manage git worktrees per-run
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IWorktreeRepository, IProjectCodebaseRepository } from '../domain/ports/index.js';
import type {
  WorktreeInfo,
  WorktreeRunType,
  WorktreeStatus,
  ProjectCodebase,
  ILogger,
} from '@generatorai/shared';
import type { GitManager } from '../infrastructure/GitManager.js';
import type { ProjectService } from './ProjectService.js';

export class WorktreeService {
  constructor(
    private readonly worktreeRepo: IWorktreeRepository,
    private readonly codebaseRepo: IProjectCodebaseRepository,
    private readonly projectService: ProjectService,
    private readonly gitManager: GitManager,
    private readonly logger: ILogger,
  ) {}

  /**
   * Create a single worktree from a project codebase.
   * When `targetDir` is provided (workspace `source/` dir), the worktree is
   * placed at `{targetDir}/{alias}`. Otherwise falls back to the project
   * worktrees directory (legacy — should always pass targetDir).
   */
  async createWorktree(
    codebaseId: string,
    runId: string,
    options?: { runType?: WorktreeRunType; baseBranch?: string; targetDir?: string },
  ): Promise<WorktreeInfo> {
    const codebase = await this.codebaseRepo.getById(codebaseId);
    if (codebase.status !== 'ready') {
      throw new Error(`Codebase "${codebase.alias}" is not ready (status: ${codebase.status})`);
    }
    if (!codebase.clonePath) {
      throw new Error(`Codebase "${codebase.alias}" has no clone path`);
    }

    const shortRunId = runId.slice(0, 8);
    // Use workspace source/ dir when provided, otherwise legacy project worktrees dir
    const worktreePath = options?.targetDir
      ? path.join(options.targetDir, codebase.alias)
      : path.join(this.projectService.getProjectWorktreesDir(codebase.projectId), runId, codebase.alias);
    const branchName = `generatorai/run-${shortRunId}-${codebase.alias}`;

    // Determine base branch
    // For bare clones (git-remote type), branches are stored directly (e.g., "main")
    // For regular repos (git-local type), use "origin/{branch}"
    let baseBranch = options?.baseBranch;
    if (!baseBranch && codebase.defaultBranch) {
      baseBranch = codebase.type === 'git-remote'
        ? codebase.defaultBranch
        : `origin/${codebase.defaultBranch}`;
    }

    // For local-dir type, just copy the directory
    if (codebase.type === 'local-dir') {
      return this.createLocalDirWorktree(codebase, runId, worktreePath, branchName, options?.runType);
    }

    // Create git worktree
    await this.gitManager.createWorktree(
      codebase.clonePath,
      worktreePath,
      branchName,
      baseBranch,
    );

    // Copy worktreeInclude files (like .env)
    await this.applyWorktreeInclude(worktreePath, codebase);

    const id = randomUUID();
    const worktree: WorktreeInfo = {
      id,
      projectId: codebase.projectId,
      codebaseId: codebase.id,
      runId,
      runType: options?.runType ?? 'workflow',
      worktreePath,
      branchName,
      status: 'active',
      createdAt: new Date(),
    };

    await this.worktreeRepo.create(worktree);
    this.logger.info(`[Worktree] Created worktree for "${codebase.alias}" at ${worktreePath}`);
    return worktree;
  }

  /**
   * Create worktrees for all selected repos in a run.
   * @param targetDir When provided, worktrees are placed at `{targetDir}/{alias}` (workspace source/).
   */
  async createRunWorktrees(
    projectId: string,
    runId: string,
    selectedAliases: string[],
    runType: WorktreeRunType = 'workflow',
    targetDir?: string,
  ): Promise<WorktreeInfo[]> {
    const results: WorktreeInfo[] = [];

    for (const aliasOrId of selectedAliases) {
      // Try by alias first, then by ID (chat frontend sends IDs, workflows send aliases)
      let codebase = await this.codebaseRepo.getByAlias(projectId, aliasOrId);
      if (!codebase) {
        try {
          codebase = await this.codebaseRepo.getById(aliasOrId);
          // Verify it belongs to the same project
          if (codebase && codebase.projectId !== projectId) {
            codebase = undefined;
          }
        } catch {
          // getById may throw if not found
        }
      }
      if (!codebase) {
        throw new Error(`Codebase "${aliasOrId}" not found in project ${projectId}`);
      }
      const worktree = await this.createWorktree(codebase.id, runId, { runType, targetDir });
      results.push(worktree);
    }

    return results;
  }

  /**
   * Remove a specific worktree.
   */
  async removeWorktree(worktreeId: string): Promise<void> {
    const worktree = await this.worktreeRepo.getById(worktreeId);
    const codebase = await this.codebaseRepo.getById(worktree.codebaseId);

    if (codebase.type !== 'local-dir' && codebase.clonePath) {
      try {
        await this.gitManager.removeWorktree(codebase.clonePath, worktree.worktreePath);
      } catch (err) {
        this.logger.warn(`[Worktree] Git worktree remove failed: ${err}`);
      }
    }

    // Clean up filesystem
    try {
      await fs.rm(worktree.worktreePath, { recursive: true, force: true });
    } catch {
      // Best effort
    }

    // Delete the DB record so the worktree no longer appears in listings
    await this.worktreeRepo.delete(worktreeId);
    this.logger.info(`[Worktree] Removed worktree ${worktreeId}`);
  }

  async listWorktrees(projectId?: string, runId?: string): Promise<WorktreeInfo[]> {
    if (runId) return this.worktreeRepo.getByRunId(runId);
    if (projectId) return this.worktreeRepo.getByProjectId(projectId);
    // All active worktrees
    return this.worktreeRepo.getByStatus('active');
  }

  async listWorktreesByCodebase(codebaseId: string): Promise<WorktreeInfo[]> {
    return this.worktreeRepo.getByCodebaseId(codebaseId);
  }

  async cleanupOrphanedWorktrees(projectId: string, _maxAgeMs?: number): Promise<number> {
    const worktrees = await this.worktreeRepo.getByProjectId(projectId);
    let cleaned = 0;

    for (const wt of worktrees) {
      // Clean up worktrees with non-active status (stale DB records from prior removals)
      if (wt.status === 'completed' || wt.status === 'orphaned' || wt.status === 'cleanup-pending') {
        try {
          // Also clean up filesystem if somehow still present
          try { await fs.rm(wt.worktreePath, { recursive: true, force: true }); } catch { /* best effort */ }
          await this.worktreeRepo.delete(wt.id);
          cleaned++;
        } catch (err) {
          this.logger.warn(`[Worktree] Failed to delete stale worktree record ${wt.id}: ${err}`);
        }
        continue;
      }

      // Active worktrees without a runId are orphans — remove them
      if (wt.status === 'active' && !wt.runId) {
        try {
          await this.removeWorktree(wt.id);
          cleaned++;
        } catch (err) {
          this.logger.warn(`[Worktree] Failed to clean up orphaned worktree ${wt.id}: ${err}`);
        }
      }
    }

    if (cleaned > 0) {
      this.logger.info(`[Worktree] Cleaned up ${cleaned} orphaned worktrees for project ${projectId}`);
    }
    return cleaned;
  }

  /**
   * Copy files listed in worktreeInclude settings (e.g., .env files).
   */
  private async applyWorktreeInclude(worktreePath: string, codebase: ProjectCodebase): Promise<void> {
    const includes = codebase.settings.worktreeInclude;
    if (!includes?.length) return;

    const sourceDir = codebase.localPath ?? codebase.clonePath;
    if (!sourceDir) return;

    for (const file of includes) {
      const src = path.join(sourceDir, file);
      const dest = path.join(worktreePath, file);
      try {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
      } catch {
        // Non-fatal — file may not exist
      }
    }
  }

  private async createLocalDirWorktree(
    codebase: ProjectCodebase,
    runId: string,
    worktreePath: string,
    branchName: string,
    runType?: WorktreeRunType,
  ): Promise<WorktreeInfo> {
    // For local-dir type, copy the directory contents
    if (!codebase.localPath) throw new Error('Local path is required');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.cp(codebase.localPath, worktreePath, { recursive: true });

    const id = randomUUID();
    const worktree: WorktreeInfo = {
      id,
      projectId: codebase.projectId,
      codebaseId: codebase.id,
      runId,
      runType: runType ?? 'workflow',
      worktreePath,
      branchName,
      status: 'active',
      createdAt: new Date(),
    };

    await this.worktreeRepo.create(worktree);
    this.logger.info(`[Worktree] Created local dir copy for "${codebase.alias}" at ${worktreePath}`);
    return worktree;
  }
}

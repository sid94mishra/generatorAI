// ────────────────────────────────────────────────────────────────
// WorktreeCleanupService — Background worktree lifecycle management
// Cleans up orphaned worktrees based on retention policies
// ────────────────────────────────────────────────────────────────

import type { IWorktreeRepository, IProjectRepository, IChatRepository } from '../domain/ports/index.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import type { ILogger, Project, WorktreeRunType } from '@generatorai/shared';
import type { WorktreeService } from './WorktreeService.js';
import * as fs from 'node:fs/promises';

const RETENTION_MS: Record<string, number> = {
  immediate: 0,
  'hours-24': 24 * 60 * 60 * 1000,
  'hours-72': 72 * 60 * 60 * 1000,
  manual: Infinity,
};

export class WorktreeCleanupService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweepInFlight = false;

  constructor(
    private readonly worktreeService: WorktreeService,
    private readonly worktreeRepo: IWorktreeRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly workflowRunRepo: IWorkflowRunRepository,
    private readonly logger: ILogger,
    /**
     * Optional chat repository. Required to correctly determine liveness of
     * chat-owned worktrees (runType 'manual'), whose `runId` is a chatId — not
     * a workflow run. Without it, chat worktrees are conservatively treated as
     * NOT orphaned to avoid deleting a live chat's working directory.
     */
    private readonly chatRepo?: IChatRepository,
    private readonly intervalMs: number = 5 * 60 * 1000, // every 5 minutes
  ) {}

  /**
   * Start the background cleanup timer.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runCleanup().catch((err) => {
        this.logger.warn('[WorktreeCleanup] sweep error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.intervalMs);
    // Don't keep the process alive just for this timer
    this.timer.unref();
    this.logger.info('[WorktreeCleanup] Started background sweep timer');
  }

  /**
   * Stop the background cleanup timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single cleanup sweep across all projects.
   * Called by the timer and can also be called manually at startup.
   */
  async runCleanup(): Promise<{ cleaned: number; orphaned: number }> {
    if (this.sweepInFlight) return { cleaned: 0, orphaned: 0 };
    this.sweepInFlight = true;
    try {
      return await this._doCleanup();
    } finally {
      this.sweepInFlight = false;
    }
  }

  /**
   * Run a cleanup sweep scoped to a SINGLE project. Used by the per-project
   * cleanup endpoints so a project-scoped request doesn't silently sweep every
   * other project (which the global `runCleanup()` does).
   */
  async runCleanupForProject(projectId: string): Promise<{ cleaned: number; orphaned: number }> {
    const project = await this.projectRepo.getById(projectId);
    const result = await this._cleanupProject(project);
    if (result.cleaned > 0 || result.orphaned > 0) {
      this.logger.info(
        `[WorktreeCleanup] Project ${projectId} sweep: cleaned=${result.cleaned}, orphaned=${result.orphaned}`,
      );
    }
    return result;
  }

  private async _doCleanup(): Promise<{ cleaned: number; orphaned: number }> {
    let cleaned = 0;
    let orphaned = 0;

    const projects = await this.projectRepo.getAll({ status: 'active' });

    for (const project of projects) {
      const result = await this._cleanupProject(project);
      cleaned += result.cleaned;
      orphaned += result.orphaned;
    }

    if (cleaned > 0 || orphaned > 0) {
      this.logger.info(`[WorktreeCleanup] Sweep: cleaned=${cleaned}, orphaned=${orphaned}`);
    }

    return { cleaned, orphaned };
  }

  /** Clean up worktrees for a single project (stale-record deletion + smart
   *  orphan detection + age-based retention). */
  private async _cleanupProject(project: Project): Promise<{ cleaned: number; orphaned: number }> {
    let cleaned = 0;
    let orphaned = 0;

    const retention = project.settings?.worktreeRetention ?? 'hours-24';
    const maxAgeMs = RETENTION_MS[retention] ?? RETENTION_MS['hours-24'] ?? 86_400_000;

    if (maxAgeMs === Infinity) return { cleaned, orphaned }; // manual retention — skip

    const worktrees = await this.worktreeRepo.getByProjectId(project.id);

    for (const wt of worktrees) {
      // Delete stale DB records (already removed worktrees that weren't deleted from DB)
      if (wt.status === 'completed' || wt.status === 'orphaned' || wt.status === 'cleanup-pending') {
        try {
          try { await fs.rm(wt.worktreePath, { recursive: true, force: true }); } catch { /* best effort */ }
          await this.worktreeRepo.delete(wt.id);
          cleaned++;
        } catch (err) {
          this.logger.warn(`[WorktreeCleanup] Failed to delete stale record ${wt.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      if (wt.status !== 'active') continue;

      // Check if the associated owner (run OR chat) has reached a terminal state
      const isOrphaned = await this.isWorktreeOrphaned(wt);
      if (isOrphaned) {
        await this.worktreeRepo.updateStatus(wt.id, 'orphaned');
        orphaned++;
      }

      // Check age-based retention
      const age = Date.now() - wt.createdAt.getTime();
      const isExpired = age >= maxAgeMs;
      const shouldClean = isOrphaned && isExpired;

      if (shouldClean) {
        try {
          await this.worktreeService.removeWorktree(wt.id);
          cleaned++;
        } catch (err) {
          this.logger.warn(`[WorktreeCleanup] Failed to clean worktree ${wt.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return { cleaned, orphaned };
  }

  /**
   * Check startup health — detect orphaned worktrees from crashed runs.
   */
  async recoverOnStartup(): Promise<{ orphaned: number; cleaned: number }> {
    this.logger.info('[WorktreeCleanup] Running startup recovery...');

    let activeWorktrees: Awaited<ReturnType<IWorktreeRepository['getByStatus']>>;
    try {
      activeWorktrees = await this.worktreeRepo.getByStatus('active');
    } catch (err) {
      this.logger.warn('[WorktreeCleanup] Failed to query active worktrees at startup', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { orphaned: 0, cleaned: 0 };
    }

    let orphaned = 0;
    let cleaned = 0;

    for (const wt of activeWorktrees) {
      const isOrphaned = await this.isWorktreeOrphaned(wt);
      if (isOrphaned) {
        await this.worktreeRepo.updateStatus(wt.id, 'orphaned');
        orphaned++;

        // Check if worktree should be auto-cleaned
        let retention = 'hours-24';
        try {
          const project = await this.projectRepo.getById(wt.projectId);
          retention = project.settings?.worktreeRetention ?? 'hours-24';
        } catch {
          // Project deleted — use default retention; age sweep will clean it
        }

        if (retention === 'immediate') {
          try {
            await this.worktreeService.removeWorktree(wt.id);
            cleaned++;
          } catch (err) {
            this.logger.warn(`[WorktreeCleanup] Startup cleanup failed for ${wt.id}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    if (orphaned > 0) {
      this.logger.info(`[WorktreeCleanup] Startup recovery: ${orphaned} orphaned, ${cleaned} cleaned`);
    }

    return { orphaned, cleaned };
  }

  /**
   * Check if a worktree is orphaned (its owner reached a terminal state or was
   * deleted). A paused run is NOT orphaned — the user may resume it.
   *
   * The owner depends on `runType`:
   *  - 'manual'  → chat-owned; `runId` is a chatId. We MUST consult the chat
   *    repo, not the workflow-run repo (the latter always throws for a chatId,
   *    which previously flagged every live chat worktree as orphaned → the
   *    chat's working directory got deleted out from under it).
   *  - 'workflow' / 'automation' → check the workflow run.
   */
  private async isWorktreeOrphaned(wt: { runId?: string; runType?: WorktreeRunType }): Promise<boolean> {
    const { runId, runType } = wt;
    if (!runId) return true;

    if (runType === 'manual') {
      // Chat-owned worktree.
      if (!this.chatRepo) {
        // Cannot verify chat liveness — be conservative and DON'T orphan it.
        // Leaking a worktree is far cheaper than deleting a live chat's dir.
        return false;
      }
      try {
        const chat = await this.chatRepo.getById(runId);
        return chat.status === 'archived'; // archived = terminal; active = live
      } catch {
        // Chat deleted — orphaned.
        return true;
      }
    }

    // Workflow / automation worktree → check the workflow run.
    try {
      const run = await this.workflowRunRepo.getById(runId);
      const terminalStates = ['completed', 'failed', 'cancelled'];
      return terminalStates.includes(run.status);
    } catch {
      // Run not found — treat as orphaned
      return true;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// WorkspaceRetentionService — the nightly sweep for execution workspaces.
//
// WHAT WAS ACTUALLY BROKEN
// ------------------------
// `WorkspaceManager.cleanupExpiredWorkspaces()` has always been correct, and
// has never reclaimed a byte on a running install, for three separate
// reasons. All three had to be fixed for a nightly job to be worth adding:
//
//   1. NOTHING SCHEDULED IT. `composition-root` starts three sweepers at boot
//      — events, durable sleep, and git worktrees — and workspace retention
//      was not among them. Its only caller was `POST /api/workspaces/cleanup`,
//      i.e. it ran when a human remembered. That is what this class fixes.
//
//   2. IT ONLY LOOKED AT `completed` WORKSPACES, and only `WorkflowRunService`
//      ever calls `completeWorkspace()`. Chat-owned workspaces — the large
//      majority — stay `active` for ever, so they were permanently exempt.
//      Hence `includeStaleActive`: eligibility is "untouched for N days",
//      which is the property a user actually means by "old".
//
//   3. IT ITERATED DATABASE ROWS, so it could not see a directory the
//      database has forgotten. Measured on a developer machine: 1,136
//      directories, of which 1,082 had no row at all — every change of
//      `DB_PATH` orphans the entire previous tree. Those are pure garbage and
//      only a filesystem pass can reclaim them; `sweepOrphans` is that pass.
//
// SAFETY POSTURE
// --------------
// This is the only scheduled job in the product that deletes user files, so
// every uncertainty resolves toward doing nothing:
//
//   * It is OPT-IN and off by default (see settings/workspaceRetention.ts).
//   * Preferences are re-read on every tick, so switching it off in Settings
//     takes effect without a restart — including part-way through a night.
//   * The orphan pass refuses to touch anything that does not resolve to
//     inside `<workspacesDir>/executions`, and skips any directory the
//     database still claims, whatever its age or status.
//   * One failure never aborts the pass; the next night retries.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import type { ILogger } from '@generatorai/shared';
import type { IExecutionWorkspaceRepository } from '../domain/ports/IExecutionWorkspaceRepository.js';

/** What the sweep reclaimed, for logs and for the manual-trigger route. */
export interface WorkspaceRetentionResult {
  /** Workspaces deleted through `WorkspaceManager` (rows + files). */
  tracked: number;
  /** Directories with no database row, removed from disk. */
  orphans: number;
  /** Directories that failed to delete; they are retried next sweep. */
  failed: number;
}

/** The slice of `WorkspaceManager` this service needs. */
export interface RetentionWorkspaceManager {
  cleanupExpiredWorkspaces(policy: {
    completedRetentionHours: number;
    archiveIfDirty: boolean;
    protectUnpushed: boolean;
    maxTotalDiskMB: number;
    respectAutomationRetention: boolean;
    includeStaleActive?: boolean;
  }): Promise<number>;
}

export interface WorkspaceRetentionPrefs {
  enabled: boolean;
  retentionDays: number;
}

export interface WorkspaceRetentionServiceOptions {
  workspaceManager: RetentionWorkspaceManager;
  workspaceRepo: IExecutionWorkspaceRepository;
  /** Root under which `executions/` lives. */
  workspacesDir: string;
  /**
   * Read the CURRENT preferences. A function rather than a value so a change
   * made in Settings applies to the next tick without a restart.
   */
  readPreferences: () => WorkspaceRetentionPrefs | Promise<WorkspaceRetentionPrefs>;
  logger: ILogger;
  /** How often to check whether tonight's sweep is due. Default hourly. */
  checkIntervalMs?: number;
  /** Local hour (0-23) at or after which the daily sweep may run. Default 3am. */
  runAtHour?: number;
  now?: () => Date;
}

const HOUR_MS = 60 * 60 * 1000;

export class WorkspaceRetentionService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Local calendar day (YYYY-MM-DD) the sweep last ran, so it runs once a day. */
  private lastRunDay: string | null = null;
  private readonly checkIntervalMs: number;
  private readonly runAtHour: number;
  private readonly now: () => Date;

  constructor(private readonly opts: WorkspaceRetentionServiceOptions) {
    this.checkIntervalMs = opts.checkIntervalMs ?? HOUR_MS;
    this.runAtHour = opts.runAtHour ?? 3;
    this.now = opts.now ?? ((): Date => new Date());
  }

  /**
   * Begin checking whether tonight's sweep is due.
   *
   * Deliberately NOT a 24-hour interval anchored to boot. This app is
   * commonly a desktop app that is closed overnight, and a job pinned to
   * 03:00 would then never run at all. "Once per calendar day, on the first
   * check at or after 03:00" fires at 03:00 on an always-on server and
   * shortly after launch on a laptop that was asleep — both get swept.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.checkIntervalMs);
    this.timer.unref?.();
    // One immediate check so a machine started at noon, days after the last
    // sweep, does not wait an hour to notice.
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private dayKey(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    const prefs = await this.opts.readPreferences();
    if (!prefs.enabled) return;
    const now = this.now();
    if (now.getHours() < this.runAtHour) return;
    const today = this.dayKey(now);
    if (this.lastRunDay === today) return;
    this.lastRunDay = today;
    try {
      await this.runOnce(prefs.retentionDays);
    } catch (err) {
      this.opts.logger.warn?.(
        `[WorkspaceRetention] nightly sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Run one full sweep. Exposed for the manual route and for tests.
   *
   * Runs regardless of the `enabled` flag — the caller decides. `tick()`
   * checks the flag; an explicit "clean up now" from the UI should not be
   * refused because the nightly job happens to be off.
   */
  async runOnce(retentionDays: number): Promise<WorkspaceRetentionResult> {
    if (this.running) return { tracked: 0, orphans: 0, failed: 0 };
    this.running = true;
    const started = Date.now();
    try {
      let tracked = 0;
      try {
        tracked = await this.opts.workspaceManager.cleanupExpiredWorkspaces({
          completedRetentionHours: retentionDays * 24,
          archiveIfDirty: true,
          protectUnpushed: true,
          maxTotalDiskMB: 10_240,
          respectAutomationRetention: true,
          // See reason 2 in the file header: without this, chat workspaces
          // are exempt for ever because nothing marks them `completed`.
          includeStaleActive: true,
        });
      } catch (err) {
        this.opts.logger.warn?.(
          `[WorkspaceRetention] tracked-workspace pass failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const { orphans, failed } = await this.sweepOrphans(retentionDays);

      if (tracked > 0 || orphans > 0 || failed > 0) {
        this.opts.logger.info?.(
          `[WorkspaceRetention] swept ${tracked} tracked + ${orphans} orphaned workspace(s) ` +
            `older than ${retentionDays}d in ${Date.now() - started}ms` +
            (failed > 0 ? `; ${failed} could not be deleted and will be retried` : ''),
        );
      }
      return { tracked, orphans, failed };
    } finally {
      this.running = false;
    }
  }

  /**
   * Delete execution directories that no database row claims.
   *
   * The claim set is built from EVERY row regardless of status, so a
   * workspace the tracked pass deliberately spared (dirty worktree, still
   * active, archived) can never be picked up here by the back door.
   */
  private async sweepOrphans(retentionDays: number): Promise<{ orphans: number; failed: number }> {
    const executionsDir = path.resolve(this.opts.workspacesDir, 'executions');
    let entries: Dirent[];
    try {
      entries = await fs.readdir(executionsDir, { withFileTypes: true });
    } catch (err) {
      // No executions directory yet is the normal state of a fresh install.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.opts.logger.warn?.(
          `[WorkspaceRetention] could not read ${executionsDir}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return { orphans: 0, failed: 0 };
    }

    const claimed = new Set<string>();
    try {
      for (const ws of await this.opts.workspaceRepo.list({})) {
        claimed.add(path.basename(ws.rootPath));
      }
    } catch (err) {
      // Without a reliable claim set every directory would look orphaned, so
      // refuse to delete anything rather than guess.
      this.opts.logger.warn?.(
        `[WorkspaceRetention] skipping orphan sweep, workspace list failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { orphans: 0, failed: 0 };
    }

    const cutoff = this.now().getTime() - retentionDays * 24 * HOUR_MS;
    let orphans = 0;
    let failed = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (claimed.has(entry.name)) continue;

      const dir = path.resolve(executionsDir, entry.name);
      // Never step outside the executions root, whatever the entry is named.
      if (dir !== executionsDir && !dir.startsWith(executionsDir + path.sep)) continue;

      try {
        const stat = await fs.stat(dir);
        if (stat.mtimeMs >= cutoff) continue;
        await fs.rm(dir, { recursive: true, force: true });
        orphans += 1;
      } catch (err) {
        // A directory held open by another process (a live browser profile,
        // an editor) fails here and is retried on the next sweep.
        failed += 1;
        this.opts.logger.debug?.(
          `[WorkspaceRetention] could not remove ${dir}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { orphans, failed };
  }
}

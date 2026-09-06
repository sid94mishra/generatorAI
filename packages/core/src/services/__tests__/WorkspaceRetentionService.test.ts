// ────────────────────────────────────────────────────────────────
// WorkspaceRetentionService.
//
// This is the only scheduled job in the product that deletes the user's
// files, so the tests that matter are the ones that pin when it REFUSES to:
// while the setting is off, on directories the database still claims, on
// anything younger than the retention period, and on anything outside the
// executions root. The reclaiming behaviour is the easy half.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceRetentionService } from '../WorkspaceRetentionService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function fakeLogger() {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn(() => l) };
  return l;
}

describe('WorkspaceRetentionService', () => {
  let root: string;
  let executions: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gai-retention-'));
    executions = join(root, 'executions');
    mkdirSync(executions, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A workspace directory whose mtime is `ageDays` old. */
  function makeDir(name: string, ageDays: number): string {
    const dir = join(executions, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'scratch.txt'), 'x');
    const when = new Date(Date.now() - ageDays * DAY_MS);
    utimesSync(dir, when, when);
    return dir;
  }

  function build(opts: {
    rows?: Array<{ rootPath: string }>;
    prefs?: { enabled: boolean; retentionDays: number };
    tracked?: number;
    now?: Date;
  }) {
    const cleanupExpiredWorkspaces = vi.fn().mockResolvedValue(opts.tracked ?? 0);
    const logger = fakeLogger();
    const service = new WorkspaceRetentionService({
      workspaceManager: { cleanupExpiredWorkspaces },
      workspaceRepo: {
        list: vi.fn().mockResolvedValue(opts.rows ?? []),
      } as never,
      workspacesDir: root,
      readPreferences: () => opts.prefs ?? { enabled: true, retentionDays: 30 },
      logger: logger as never,
      ...(opts.now ? { now: () => opts.now as Date } : {}),
    });
    return { service, cleanupExpiredWorkspaces, logger };
  }

  describe('the orphan sweep', () => {
    it('removes a directory no database row claims, once it is past retention', async () => {
      const old = makeDir('orphan-old', 40);
      const { service } = build({ rows: [] });

      const result = await service.runOnce(30);

      expect(existsSync(old)).toBe(false);
      expect(result.orphans).toBe(1);
    });

    it('leaves a directory younger than the retention period alone', async () => {
      const fresh = makeDir('orphan-fresh', 5);
      const { service } = build({ rows: [] });

      const result = await service.runOnce(30);

      expect(existsSync(fresh)).toBe(true);
      expect(result.orphans).toBe(0);
    });

    it('never touches a directory the database still claims, however old', async () => {
      // The tracked pass decides those, and it applies the dirty-worktree and
      // still-active protections the orphan sweep knows nothing about. Age
      // alone must not be enough to get past that.
      const claimed = makeDir('claimed-ancient', 400);
      const { service } = build({ rows: [{ rootPath: join(executions, 'claimed-ancient') }] });

      const result = await service.runOnce(30);

      expect(existsSync(claimed)).toBe(true);
      expect(result.orphans).toBe(0);
    });

    it('deletes nothing when the workspace list cannot be read', async () => {
      // Without a reliable claim set, EVERY directory looks orphaned. Failing
      // closed here is the difference between "no cleanup tonight" and
      // "deleted every live workspace".
      const old = makeDir('orphan-old', 90);
      const logger = fakeLogger();
      const service = new WorkspaceRetentionService({
        workspaceManager: { cleanupExpiredWorkspaces: vi.fn().mockResolvedValue(0) },
        workspaceRepo: { list: vi.fn().mockRejectedValue(new Error('db is down')) } as never,
        workspacesDir: root,
        readPreferences: () => ({ enabled: true, retentionDays: 30 }),
        logger: logger as never,
      });

      const result = await service.runOnce(30);

      expect(existsSync(old)).toBe(true);
      expect(result.orphans).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('survives a missing executions directory', async () => {
      rmSync(executions, { recursive: true, force: true });
      const { service, logger } = build({ rows: [] });

      await expect(service.runOnce(30)).resolves.toEqual({ tracked: 0, orphans: 0, failed: 0 });
      // A fresh install has no executions directory; that is not a problem.
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('ignores files sitting next to the workspace directories', async () => {
      writeFileSync(join(executions, 'stray.log'), 'not a workspace');
      const { service } = build({ rows: [] });

      const result = await service.runOnce(30);

      expect(result.orphans).toBe(0);
      expect(existsSync(join(executions, 'stray.log'))).toBe(true);
    });
  });

  describe('the tracked pass', () => {
    it('asks for stale active workspaces, not just completed ones', async () => {
      // Only WorkflowRunService marks a workspace `completed`, so without this
      // flag every chat-owned workspace is exempt for ever — which was most of
      // what accumulated.
      const { service, cleanupExpiredWorkspaces } = build({ rows: [] });

      await service.runOnce(30);

      expect(cleanupExpiredWorkspaces).toHaveBeenCalledWith(
        expect.objectContaining({ includeStaleActive: true, completedRetentionHours: 30 * 24 }),
      );
    });

    it('still sweeps orphans when the tracked pass throws', async () => {
      const old = makeDir('orphan-old', 60);
      const logger = fakeLogger();
      const service = new WorkspaceRetentionService({
        workspaceManager: { cleanupExpiredWorkspaces: vi.fn().mockRejectedValue(new Error('boom')) },
        workspaceRepo: { list: vi.fn().mockResolvedValue([]) } as never,
        workspacesDir: root,
        readPreferences: () => ({ enabled: true, retentionDays: 30 }),
        logger: logger as never,
      });

      const result = await service.runOnce(30);

      expect(result.tracked).toBe(0);
      expect(result.orphans).toBe(1);
      expect(existsSync(old)).toBe(false);
    });
  });

  describe('scheduling', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('does nothing at all while the setting is off', async () => {
      const old = makeDir('orphan-old', 90);
      const { service, cleanupExpiredWorkspaces } = build({
        rows: [],
        prefs: { enabled: false, retentionDays: 30 },
        now: new Date(2026, 0, 2, 4, 0, 0),
      });

      service.start();
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(cleanupExpiredWorkspaces).not.toHaveBeenCalled();
      expect(existsSync(old)).toBe(true);
      service.stop();
    });

    it('waits until the configured hour', async () => {
      const { service, cleanupExpiredWorkspaces } = build({
        rows: [],
        now: new Date(2026, 0, 2, 1, 0, 0), // 1am, before the 3am default
      });

      service.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(cleanupExpiredWorkspaces).not.toHaveBeenCalled();
      service.stop();
    });

    it('runs once per calendar day, not once per tick', async () => {
      const { service, cleanupExpiredWorkspaces } = build({
        rows: [],
        now: new Date(2026, 0, 2, 4, 0, 0),
      });

      service.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(cleanupExpiredWorkspaces).toHaveBeenCalledTimes(1);

      // Several more hourly checks on the same day must not re-run it.
      await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
      expect(cleanupExpiredWorkspaces).toHaveBeenCalledTimes(1);
      service.stop();
    });

    it('sweeps shortly after launch when the machine was asleep at 3am', async () => {
      // A desktop app closed overnight would never fire a job pinned to 03:00.
      const { service, cleanupExpiredWorkspaces } = build({
        rows: [],
        now: new Date(2026, 0, 2, 12, 0, 0), // launched at noon
      });

      service.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(cleanupExpiredWorkspaces).toHaveBeenCalledTimes(1);
      service.stop();
    });

    it('stop() ends the schedule', async () => {
      const { service, cleanupExpiredWorkspaces } = build({
        rows: [],
        now: new Date(2026, 0, 2, 4, 0, 0),
      });
      service.start();
      await vi.advanceTimersByTimeAsync(0);
      service.stop();
      cleanupExpiredWorkspaces.mockClear();

      await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
      expect(cleanupExpiredWorkspaces).not.toHaveBeenCalled();
    });
  });
});

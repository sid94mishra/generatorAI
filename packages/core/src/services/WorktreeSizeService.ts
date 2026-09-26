// ────────────────────────────────────────────────────────────────
// WorktreeSizeService — async, cached "disk usage" for worktrees (G-17)
// ────────────────────────────────────────────────────────────────
//
// CodebaseDetail's Size column ("1.27 GB on disk · frees 385 MB") needs a
// directory size that can be expensive to compute (a worktree can hold
// node_modules, build output, …). Per 05-gap-matrix §G-17 and §5's rules:
// "compute disk usage asynchronously with a bounded concurrency and a
// cache/TTL", "cross-platform file/disk APIs only" — plain `fs.promises`
// recursive walk, never a shelled-out `du` (Windows has none).
//
// `getCachedSizeBytes` never blocks: it returns whatever is cached (possibly
// stale, possibly `undefined` if never measured) and separately kicks off a
// background remeasurement when the cache is missing or older than the TTL.
// The list route calls it per worktree and renders `undefined` as "unknown"
// (D-36) rather than a fake `0`.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ILogger } from '@generatorai/shared';

const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_CONCURRENCY = 2;

interface SizeCacheEntry {
  sizeBytes: number;
  measuredAt: number;
}

export class WorktreeSizeService {
  private readonly cache = new Map<string, SizeCacheEntry>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly logger: ILogger,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxConcurrency: number = DEFAULT_MAX_CONCURRENCY,
  ) {}

  /** Cached size, or `undefined` if never successfully measured. Never blocks. */
  getCachedSizeBytes(worktreeId: string): number | undefined {
    return this.cache.get(worktreeId)?.sizeBytes;
  }

  /**
   * Kicks off an async remeasurement if the cache is missing or stale and
   * there is a free measurement slot. Fire-and-forget by design: a caller
   * that wants the fresh number waits for a LATER call (e.g. the next poll),
   * never this one — measuring a large worktree must not hold up the list.
   * Bounded concurrency means a request beyond `maxConcurrency` is simply
   * skipped this round; the next list poll retries it.
   */
  requestMeasurement(worktreeId: string, dirPath: string): void {
    const entry = this.cache.get(worktreeId);
    const stale = !entry || Date.now() - entry.measuredAt >= this.ttlMs;
    if (!stale || this.inFlight.has(worktreeId)) return;
    if (this.inFlight.size >= this.maxConcurrency) return;

    this.inFlight.add(worktreeId);
    void WorktreeSizeService.measureDirSize(dirPath)
      .then((sizeBytes) => {
        this.cache.set(worktreeId, { sizeBytes, measuredAt: Date.now() });
      })
      .catch((err) => {
        this.logger.warn(`[WorktreeSize] Failed to measure ${dirPath}: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        this.inFlight.delete(worktreeId);
      });
  }

  /** Drops a worktree's cached size (e.g. once it has been removed). */
  invalidate(worktreeId: string): void {
    this.cache.delete(worktreeId);
  }

  /**
   * Recursive size walk with plain `fs.promises` — portable to Windows,
   * macOS and Linux alike. Symlinks are never followed (avoids cycles and
   * escaping the worktree); an entry that vanishes mid-walk (a build running
   * concurrently) is simply skipped rather than failing the whole walk.
   */
  private static async measureDirSize(dirPath: string): Promise<number> {
    let total = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        try {
          const st = await fs.stat(full);
          total += st.size;
        } catch {
          // Vanished between readdir and stat — skip it.
        }
      }
    };
    await walk(dirPath);
    return total;
  }
}

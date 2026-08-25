// ────────────────────────────────────────────────────────────────
// EventRetentionService — DB-04
//
// Background job that prunes unbounded event-log tables:
//   - `events` (legacy per-session AgentEvent log)
//   - `stream_cursors` (STR-02 per-scope persistent stream log)
//
// Both tables accumulate forever without intervention. The service runs a
// bounded DELETE on each sweep (capped by `maxDeletePerSweep` so a single
// sweep can't hold the SQLite write lock indefinitely) and loops on a
// timer. When EVT-04 lands (external payload blobs), this service is the
// natural home for blob-file cleanup too — the API exposes `registerSweeper`
// so future callers plug in without touching core.
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import type { AppDatabase } from '../index.js';

export interface EventRetentionConfig {
  /** TTL (days) for event payloads. Rows older than this are deleted. */
  eventPayloadTtlDays: number;
  /** How often (ms) the sweeper runs. */
  sweepIntervalMs: number;
  /** Safety: max rows deleted per table per sweep. */
  maxDeletePerSweep: number;
  /** Disable the background sweeper entirely. */
  enabled: boolean;
  /**
   * Reclaim freed pages after a sweep that deleted rows. Requires
   * `auto_vacuum=INCREMENTAL`, which is probed once at `start()`; a database
   * that does not have it logs so and skips. Defaults to true.
   */
  incrementalVacuum?: boolean;
  /** Pages reclaimed per incremental-vacuum step. Defaults to 2000 (~8 MB). */
  vacuumPagesPerSweep?: number;
  /** Run `PRAGMA optimize` every N sweeps. 0 disables. Defaults to 24. */
  analyzeEverySweeps?: number;
}

export interface RetentionLogger {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Hook signature for future plug-in sweepers (e.g. blob payload files). */
export type RetentionSweeper = (cutoffTs: number, limit: number) => Promise<number>;

export class EventRetentionService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly customSweepers: Array<{ name: string; fn: RetentionSweeper }> = [];
  private running = false;
  private sweepCount = 0;
  private incrementalVacuumSupported = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly config: EventRetentionConfig,
    private readonly logger?: RetentionLogger,
  ) {}

  /**
   * Allow future modules (EVT-04 blob store, artifact retention, etc.) to
   * register their own sweeper function. `cutoffTs` is epoch-ms; the sweeper
   * must only remove rows/files strictly older than this, and is capped by
   * `limit` to match the DB cap semantics.
   */
  registerSweeper(name: string, fn: RetentionSweeper): void {
    this.customSweepers.push({ name, fn });
  }

  /** Start the background sweeper. No-op if `enabled=false`. */
  start(): void {
    if (!this.config.enabled) {
      this.logger?.info?.('[Retention] disabled by config');
      return;
    }
    if (this.timer) return; // already running

    // W02 — `PRAGMA incremental_vacuum` on a database whose `auto_vacuum` is
    // NONE succeeds and does nothing. There is no error to catch, so without
    // this probe the reclaim half of retention would appear to work forever
    // while returning zero pages. Every database created before this release
    // is NONE; `pnpm db:reclaim` is what changes it, because the mode only
    // takes effect on a full VACUUM.
    this.incrementalVacuumSupported = this.probeAutoVacuum();

    // Kick off one sweep immediately so test / CLI startups don't have to
    // wait `sweepIntervalMs` for the first prune.
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.config.sweepIntervalMs);
    // Don't let the timer keep the event loop alive on its own — if the
    // server wants to exit, the sweeper should not block.
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.logger?.info?.('[Retention] sweeper started', {
      intervalMs: this.config.sweepIntervalMs,
      ttlDays: this.config.eventPayloadTtlDays,
      incrementalVacuum: this.incrementalVacuumSupported ? 'active' : 'inert',
    });
    if (!this.incrementalVacuumSupported && (this.config.incrementalVacuum ?? true)) {
      // WARN, not a footnote on the info line: deleting rows without reclaiming
      // pages keeps the file at its current size forever. Every database
      // created before this release lands here, and the operator has to act —
      // the mode can only change during a full VACUUM.
      this.logger?.warn?.(
        '[Retention] auto_vacuum is not INCREMENTAL, so deleted pages will NOT be ' +
          'returned to the filesystem. Row growth is bounded but the file will not ' +
          'shrink. Run `pnpm db:reclaim` once, with the server stopped, to fix this.',
      );
    }
  }

  /** Read `PRAGMA auto_vacuum`. 2 = INCREMENTAL, which is the only usable mode. */
  private probeAutoVacuum(): boolean {
    if (!(this.config.incrementalVacuum ?? true)) return false;
    try {
      const sqlite = (this.db as unknown as { session: { client: Database.Database } }).session.client;
      return Number(sqlite.pragma('auto_vacuum', { simple: true })) === 2;
    } catch {
      return false;
    }
  }

  /** Stop the background sweeper. Safe to call multiple times. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run a single sweep. Exposed for tests + manual cleanup. */
  async sweep(): Promise<{
    eventsDeleted: number;
    streamCursorsDeleted: number;
    customDeleted: Record<string, number>;
  }> {
    if (this.running) {
      // Avoid re-entrance if the previous sweep is still running (rare, but
      // possible when sweepIntervalMs is set very low for tests).
      return { eventsDeleted: 0, streamCursorsDeleted: 0, customDeleted: {} };
    }
    this.running = true;
    try {
      const cutoff = Date.now() - this.config.eventPayloadTtlDays * 24 * 60 * 60 * 1000;
      const limit = this.config.maxDeletePerSweep;
      const sqlite = (this.db as unknown as { session: { client: Database.Database } }).session.client;

      // ── events table (timestamp column, epoch-ms) ──
      const eventsDeleted = sqlite
        .prepare(
          `DELETE FROM events WHERE rowid IN (
             SELECT rowid FROM events WHERE timestamp < ? ORDER BY timestamp ASC LIMIT ?
           )`,
        )
        .run(cutoff, limit).changes;

      // ── stream_cursors (ts column, epoch-ms) ──
      // When we delete stream_cursors rows we do NOT reset the per-scope
      // `stream_sequences.last_seq` counter — clients that come back with a
      // stale Last-Event-ID just won't find those rows in replay (their
      // cursor has expired), which is the correct behaviour.
      const streamCursorsDeleted = sqlite
        .prepare(
          `DELETE FROM stream_cursors WHERE rowid IN (
             SELECT rowid FROM stream_cursors WHERE ts < ? ORDER BY ts ASC LIMIT ?
           )`,
        )
        .run(cutoff, limit).changes;

      // ── custom sweepers (future EVT-04 blob store, etc.) ──
      const customDeleted: Record<string, number> = {};
      for (const { name, fn } of this.customSweepers) {
        try {
          customDeleted[name] = await fn(cutoff, limit);
        } catch (err) {
          this.logger?.warn?.('[Retention] custom sweeper failed', {
            sweeper: name,
            error: err instanceof Error ? err.message : String(err),
          });
          customDeleted[name] = 0;
        }
      }

      if (eventsDeleted > 0 || streamCursorsDeleted > 0) {
        this.logger?.info?.('[Retention] sweep complete', {
          cutoff,
          eventsDeleted,
          streamCursorsDeleted,
          customDeleted,
        });
      }

      this.sweepCount += 1;
      this.reclaimAndAnalyze(sqlite, eventsDeleted + streamCursorsDeleted);

      return { eventsDeleted, streamCursorsDeleted, customDeleted };
    } catch (err) {
      this.logger?.error?.('[Retention] sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { eventsDeleted: 0, streamCursorsDeleted: 0, customDeleted: {} };
    } finally {
      this.running = false;
    }
  }

  /**
   * W02 — deleting rows does not shrink the file. SQLite parks freed pages on
   * the free list and only returns them to the filesystem on VACUUM. A full
   * VACUUM is not an option here (it rewrites the whole database under an
   * exclusive lock), so we take bounded incremental steps.
   *
   * Both statements below run on `better-sqlite3`, which is synchronous, on the
   * server's only thread. Their cost is therefore a stall for every request,
   * SSE write and harness read in flight — which is why:
   *   - `incremental_vacuum` is capped at a page count worth a few megabytes
   *     rather than the whole free list, and
   *   - the planner refresh is `PRAGMA optimize`, not `ANALYZE`. `optimize` is
   *     designed for exactly this call site: it analyses only the tables whose
   *     statistics have gone stale and is typically milliseconds, whereas a
   *     bare `ANALYZE` rescans every index on a multi-gigabyte file and would
   *     block the loop for seconds.
   */
  private reclaimAndAnalyze(sqlite: Database.Database, deleted: number): void {
    if (deleted > 0 && this.incrementalVacuumSupported) {
      try {
        const pages = this.config.vacuumPagesPerSweep ?? 2_000;
        sqlite.pragma(`incremental_vacuum(${pages})`);
      } catch (err) {
        this.logger?.warn?.('[Retention] incremental vacuum failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const every = this.config.analyzeEverySweeps ?? 24;
    if (every > 0 && this.sweepCount % every === 0) {
      try {
        sqlite.pragma('optimize');
      } catch (err) {
        this.logger?.warn?.('[Retention] PRAGMA optimize failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

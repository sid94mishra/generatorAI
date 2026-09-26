// ────────────────────────────────────────────────────────────────
// OutboxDispatcher — engine events leave through the outbox (P03 WP-3.6,
// G5 §5.8; fixes the run-scope holes of B-21 for engine events).
//
// Every `emit` decision is persisted in `workflow_outbox` in the same
// transaction as the state change it describes. After each commit (and at
// boot) the dispatcher drains a run's rows in `run_seq` order: each is
// PUBLISHED AND AWAITED, and only then marked dispatched. A crash between
// the publish and the mark re-publishes the row once (at-least-once; the
// consumers key on the run's sequence). A publish failure stops that run's
// drain; the next kick retries from the same row, so order is kept.
//
// Terminal events keep the kinds and payload the P03–P04 window reads
// (RV-5): `workflow_run.completed | failed | cancelled` with
// `data.workflowRunId`.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { IWorkflowOutboxStore, OutboxRecord } from '../../domain/ports/IEngineStore.js';

/** Publishes one engine event; the dispatcher awaits it before marking the row. */
export type OutboxPublisher = (event: { kind: string; data: Record<string, unknown> }, row: OutboxRecord) => Promise<void>;

export interface OutboxDispatcherDeps {
  outbox: IWorkflowOutboxStore;
  publish: OutboxPublisher;
  now?: () => number;
  logger?: ILogger | undefined;
  /** Retry a failed run drain after this long (ms). */
  retryAfterMs?: number;
}

export class OutboxDispatcher {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private stopped = false;

  constructor(private readonly deps: OutboxDispatcherDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Drain a run's pending rows after a commit (serialised per run). */
  kick(runId: string): void {
    if (this.stopped) return;
    const prev = this.chains.get(runId) ?? Promise.resolve();
    const next = prev.then(() => this.drainRun(runId));
    this.chains.set(runId, next);
    void next.finally(() => {
      if (this.chains.get(runId) === next) this.chains.delete(runId);
    });
  }

  /** Boot: every run's undispatched rows. */
  async drainAll(): Promise<void> {
    const runs = new Set(this.deps.outbox.listPending(5_000).map((r) => r.workflowRunId));
    for (const runId of runs) this.kick(runId);
    await this.idle();
  }

  /** Resolves once every queued drain finished (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.chains.size > 0) await Promise.allSettled([...this.chains.values()]);
  }

  stop(): void {
    this.stopped = true;
  }

  private async drainRun(runId: string): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const rows = this.deps.outbox.listPending(200, runId);
      if (rows.length === 0) return;
      for (const row of rows) {
        try {
          await this.deps.publish({ kind: row.kind, data: row.payload }, row);
        } catch (err) {
          this.deps.logger?.warn(`[OutboxDispatcher] publishing ${row.kind} (${runId}#${row.runSeq}) failed; will retry: ${String(err)}`);
          const t = setTimeout(() => this.kick(runId), this.deps.retryAfterMs ?? 1_000);
          t.unref?.();
          return;
        }
        this.deps.outbox.markDispatched(runId, row.runSeq, this.now());
      }
    }
  }
}

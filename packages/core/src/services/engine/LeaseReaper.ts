// ────────────────────────────────────────────────────────────────
// LeaseReaper — the 15 s backstop behind the executor's own watchdogs
// (P03 WP-3.6, G5 §5.6).
//
// An attempt's lease is renewed every 20 s while its frame is alive; the
// executor's idle watchdog and attempt deadline handle a wedged turn inside
// a live process (B-8). What is left is a frame that stopped renewing
// without reporting (a hung event loop, a lost frame): every 15 s the reaper
// lists instances in an attempt state whose lease expired, of runs THIS
// process owns (RV-27), and posts `lease_expired`. The actor's CAS on the
// lease owner decides; the in-flight turn's replay policy decides between a
// resume and a pause (G5 §3.10), never a completion. The awaiting states
// carry no lease and are never reaped (B-2).
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { EngineStores } from '../../domain/ports/IEngineStore.js';
import type { RunMessage } from '../../domain/scheduler/types.js';
import { journalEpoch, type StageExecutor } from './StageExecutor.js';

export interface LeaseReaperDeps {
  /** The run owner id this process claims runs with (its boot id). */
  ownerId: string;
  stores: EngineStores;
  executor: StageExecutor;
  post: (runId: string, msg: RunMessage) => void;
  now?: () => number;
  logger?: ILogger | undefined;
  everyMs?: number;
}

/** Whether every turn in flight for the instance's journal epoch may be re-sent. */
export function inFlightIsSafe(stores: EngineStores, stageRunId: string): boolean {
  const inst = stores.stages.getInstance(stageRunId);
  if (!inst || inst.currentAttempt === 0) return true;
  const epoch = journalEpoch(stores.attempts.listByStageRun(stageRunId), inst.currentAttempt);
  return stores.turns.inFlight(stageRunId, `a${epoch}/`).every((t) => t.policy === 'safe');
}

export class LeaseReaper {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;

  constructor(private readonly deps: LeaseReaperDeps) {
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.deps.everyMs ?? 15_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass: post `lease_expired` for every expired lease of an owned run. Returns how many. */
  sweep(): number {
    const { stores, executor } = this.deps;
    let n = 0;
    for (const e of stores.queries.listExpiredLeases(this.deps.ownerId, this.now())) {
      const inst = stores.stages.getInstance(e.stageRunId);
      if (!inst) continue;
      this.deps.post(e.workflowRunId, {
        type: 'lease_expired',
        stageRunId: e.stageRunId,
        owner: e.leaseOwner ?? '',
        safeReplay: inFlightIsSafe(stores, e.stageRunId),
      });
      // A frame that stopped renewing is stopped too; its CASes would fail anyway.
      executor.abort(e.stageRunId, inst.currentAttempt, 'cancel');
      n += 1;
    }
    if (n > 0) this.deps.logger?.warn(`[LeaseReaper] ${n} expired lease(s) reported`);
    return n;
  }
}

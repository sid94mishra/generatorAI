// ────────────────────────────────────────────────────────────────
// EffectsDispatcher — what a committed decision batch does to the world
// (P03 WP-3.6, G5§5.1).
//
// Runs AFTER `RunStore.apply` committed, never inside it:
//   - timers the batch armed go to the TimerService;
//   - the run's outbox is drained (published and awaited, in order);
//   - `launch` waits for a slot of the admission controller — THE one
//     concurrency gate of the engine (W-66; there is no stage semaphore) —
//     while the instance stays `ready`, so the wait never counts as attempt
//     time; the executor's claim ends it;
//   - `abort` drops a launch still queued for its slot, or stops the frame;
//   - `deliver_input` hands a verdict to a parked frame (with no frame left,
//     the attempt is settled and the approval is posted again, so it takes
//     the no-frame path);
//   - `prepare` and `finalize` run the run lifecycle and post their result.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { ArmedTimer } from '../../domain/ports/IRunStore.js';
import type { Decision, RunMessage, RunOutcome } from '../../domain/scheduler/types.js';
import type { AdmissionController } from '../AdmissionController.js';
import type { OutboxDispatcher } from './OutboxDispatcher.js';
import { PrepareError, type RunLifecycle } from './RunLifecycle.js';
import type { StageExecutor } from './StageExecutor.js';
import type { TimerService } from './TimerService.js';

export interface EffectsDispatcherDeps {
  executor: StageExecutor;
  admission: AdmissionController;
  timers: TimerService;
  outbox: OutboxDispatcher;
  lifecycle: RunLifecycle;
  post: (runId: string, msg: RunMessage) => void;
  logger?: ILogger | undefined;
}

interface QueuedLaunch {
  attemptNo: number;
  dropped: boolean;
}

export class EffectsDispatcher {
  /** Launches waiting for an admission slot, by instance. */
  private readonly queued = new Map<string, QueuedLaunch>();
  /** Launches in flight (admitted or queued): what `idle()` waits for. */
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(private readonly deps: EffectsDispatcherDeps) {}

  dispatch(runId: string, batch: { effects: readonly Decision[]; timers: readonly ArmedTimer[]; outbox: readonly number[] }): void {
    for (const t of batch.timers) this.deps.timers.arm(t);
    if (batch.outbox.length > 0) this.deps.outbox.kick(runId);
    for (const d of batch.effects) {
      switch (d.t) {
        case 'launch':
          this.launch(runId, d.stageRunId, d.attemptNo);
          break;
        case 'abort': {
          const q = this.queued.get(d.stageRunId);
          if (q && q.attemptNo === d.attemptNo) q.dropped = true;
          else this.deps.executor.abort(d.stageRunId, d.attemptNo, d.reason);
          break;
        }
        case 'deliver_input':
          if (!this.deps.executor.deliverInput(d.stageRunId, d.attemptNo, d.verdict)) {
            // The frame is gone (a restart): settle the attempt, then the
            // approval takes the no-frame path (a resume attempt carries it).
            this.deps.post(runId, { type: 'attempt_settled', stageRunId: d.stageRunId, attemptNo: d.attemptNo, outcome: { kind: 'aborted', reason: 'superseded' } });
            this.deps.post(runId, {
              type: 'command',
              command: {
                command: 'approve',
                instanceId: d.stageRunId,
                outcome: d.verdict.outcome,
                ...(d.verdict.feedback !== undefined ? { feedback: d.verdict.feedback } : {}),
                ...(d.verdict.data !== undefined ? { data: d.verdict.data } : {}),
              },
            });
          }
          break;
        case 'prepare':
          this.track(this.prepare(runId));
          break;
        case 'finalize':
          this.track(this.finalize(runId, d.outcome, d.compensate));
          break;
        default:
          break; // `reject` is the actor's reply to its command
      }
    }
  }

  /** Queue a launch behind the admission gate; the executor claims the instance once a slot is free. */
  launch(runId: string, stageRunId: string, attemptNo: number): void {
    const entry: QueuedLaunch = { attemptNo, dropped: false };
    this.queued.set(stageRunId, entry);
    const run = this.deps.admission
      .admit('ordinary', async (ticket) => {
        if (this.queued.get(stageRunId) === entry) this.queued.delete(stageRunId);
        if (entry.dropped) return;
        await this.deps.executor.start({ runId, stageRunId, attemptNo }, ticket);
      })
      .catch((err: unknown) => {
        if (this.queued.get(stageRunId) === entry) this.queued.delete(stageRunId);
        // The instance stays `ready`: its queue_timeout timer decides (G5 §5.11).
        this.deps.logger?.warn(`[EffectsDispatcher] launch of ${stageRunId} was not admitted: ${String(err)}`);
      });
    this.track(run);
  }

  /** Resolves once every launch and lifecycle effect in flight has settled (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  private track(p: Promise<unknown>): void {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  private async prepare(runId: string): Promise<void> {
    try {
      await this.deps.lifecycle.prepare(runId);
      this.deps.post(runId, { type: 'prepared' });
    } catch (err) {
      this.deps.post(runId, {
        type: 'prepare_failed',
        phase: err instanceof PrepareError ? err.phase : 'prepare',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async finalize(runId: string, outcome: RunOutcome, compensate: readonly string[]): Promise<void> {
    try {
      const r = await this.deps.lifecycle.finalize(runId, outcome, compensate);
      // A cancel superseded this finalize: the cancel's own finalize reports the outcome.
      if (r.superseded) return;
      this.deps.post(runId, { type: 'finalized', ok: r.ok, ...(r.error ? { error: r.error } : {}) });
    } catch (err) {
      this.deps.post(runId, { type: 'finalized', ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

// ────────────────────────────────────────────────────────────────
// EffectsDispatcher — what a committed decision batch does to the world
// (P03 WP-3.6, G5§5.1).
//
// Runs AFTER `RunStore.apply` committed, never inside it:
//   - timers the batch armed go to the TimerService;
//   - the run's outbox is drained (published and awaited, in order);
//   - `launch` waits for the stage's flow keys of the admission controller
//     — THE one concurrency gate of the engine (W-66, P07 WP-7.2): `global`,
//     `provider:<id>` and a configured `model:<id>`, or `check:global` for a
//     `check` stage (P05 §1.2) — all at once, while the instance stays
//     `ready`, so the wait never counts as attempt time; the executor's
//     claim ends it. A wait is announced (`stage_run.admission_queued`,
//     then `stage_run.admission_granted`) so the run page can say what the
//     stage waits for;
//   - `abort` drops a launch still queued for its slot, or stops the frame;
//   - `deliver_input` hands a verdict to a parked frame (with no frame left,
//     the attempt is settled and the approval is posted again, so it takes
//     the no-frame path);
//   - `prepare` and `finalize` run the run lifecycle and post their result;
//   - `capture_iteration` / `restore_iteration` (P05 loops) run the loop
//     effects and post `iteration_captured` / `iteration_restored`;
//   - `map_snapshot` / `map_prepare_item` / `map_merge_item` / `map_release`
//     (P05 maps) run the map effects; a launch outside a mount_per_item map
//     item first takes the `write` lease of the run mounts, so it waits
//     while a map holds them (WorktreeLeases);
//   - `start_child` / `child_command` (P05 sub-workflows) invoke the child
//     run, or cancel, pause or resume it;
//   - `summarize` (P07 WP-7.1) writes a completed stage's `llm` summary and
//     posts `summary_ready`.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { ArmedTimer } from '../../domain/ports/IRunStore.js';
import type { Decision, RunMessage, RunOutcome } from '../../domain/scheduler/types.js';
import { CHECK_FLOW_KEY, GLOBAL_FLOW_KEY, type AdmissionController, type AdmissionTicket, type FlowState } from '../AdmissionController.js';
import type { LoopEffects } from './LoopEffects.js';
import type { MapEffects } from './MapEffects.js';
import type { SubworkflowEffects } from './SubworkflowEffects.js';
import type { SummaryEffects } from './summaries.js';
import type { WorktreeLeases } from './WorktreeLeases.js';
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
  /** The loop effects (tree hashes, iteration checkpoints and restores). */
  loops?: LoopEffects | undefined;
  /** The flow keys a launch is admitted on (default: `global`). */
  flowKeysOf?: ((runId: string, stageRunId: string) => Promise<string[]>) | undefined;
  /** Where the admission wait is announced (`stage_run.admission_queued` / `_granted`). */
  notify?: ((kind: string, data: Record<string, unknown>) => void) | undefined;
  /** The map effects (snapshots, item mounts, merges) and the run-mount leases. */
  maps?: MapEffects | undefined;
  leases?: WorktreeLeases | undefined;
  /** The run-mount lease keys a launch must hold `write` on (none inside a mount_per_item item). */
  writerLeaseKeys?: ((runId: string, stageRunId: string) => Promise<string[]>) | undefined;
  /** The sub-workflow effects (invoke the child, propagate commands). */
  subworkflows?: SubworkflowEffects | undefined;
  /** The `llm` summaries written after completion. */
  summaries?: SummaryEffects | undefined;
  logger?: ILogger | undefined;
}

/** What a queued launch waits for, as the run page shows it: `provider claude-agent`. */
export function flowLabel(flowKey: string): string {
  if (flowKey === GLOBAL_FLOW_KEY) return 'the global stage limit';
  if (flowKey === CHECK_FLOW_KEY) return 'the check limit';
  const at = flowKey.indexOf(':');
  return at > 0 ? `${flowKey.slice(0, at)} ${flowKey.slice(at + 1)}` : flowKey;
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
  /** Launches waiting for the run mounts' `write` lease (a mount_per_item map holds them). */
  private readonly leaseWaits = new Set<string>();

  constructor(private readonly deps: EffectsDispatcherDeps) {}

  /** Whether the instance's launch is waiting for a worktree lease (its queue_timeout does not count then). */
  waitingOnLease(stageRunId: string): boolean {
    return this.leaseWaits.has(stageRunId);
  }

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
            // The frame is gone (a restart): the frame_lost rules apply (an
            // in-turn gate pauses; a completion review stays parked), then
            // the approval takes the no-frame path (a resume attempt carries
            // it) — never into a gate it was not given for (ENGINE-R2).
            this.deps.post(runId, { type: 'frame_lost', stageRunId: d.stageRunId, attemptNo: d.attemptNo });
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
        case 'capture_iteration':
          this.track(this.captureIteration(runId, d.stageRunId, d.k, d.at, d.checkpoint));
          break;
        case 'restore_iteration':
          this.track(this.restoreIteration(runId, d.stageRunId, d.k, d.checkpointTurnId));
          break;
        case 'map_snapshot':
          this.track(this.mapSnapshot(runId, d.stageRunId));
          break;
        case 'map_prepare_item':
          this.track(this.mapPrepareItem(runId, d.stageRunId, d.index));
          break;
        case 'map_merge_item':
          this.track(this.mapMergeItem(runId, d.stageRunId, d.index, d.strategy));
          break;
        case 'map_release':
          this.deps.maps?.release(d.stageRunId);
          break;
        case 'start_child':
          this.track(this.startChild(runId, d.stageRunId, d.inputs));
          break;
        case 'summarize':
          this.track(this.deps.summaries?.summarize(runId, d.stageRunId) ?? Promise.resolve());
          break;
        case 'child_command':
          this.track(this.deps.subworkflows?.childCommand(d.childRunId, d.command) ?? Promise.resolve());
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
    let waited: FlowState | undefined;
    const body = async (ticket: AdmissionTicket): Promise<void> => {
      if (this.queued.get(stageRunId) === entry) this.queued.delete(stageRunId);
      if (waited) this.deps.notify?.('stage_run.admission_granted', { stageRunId, workflowRunId: runId, flowKey: waited.flowKey });
      if (entry.dropped) return;
      await this.deps.executor.start({ runId, stageRunId, attemptNo }, ticket);
    };
    const admitted = async (): Promise<void> => {
      const keys = this.deps.flowKeysOf ? await this.deps.flowKeysOf(runId, stageRunId) : [GLOBAL_FLOW_KEY];
      return this.deps.admission.admitFlows(keys, body, (blocking) => {
        waited = blocking;
        this.deps.notify?.('stage_run.admission_queued', {
          stageRunId,
          workflowRunId: runId,
          flowKey: blocking.flowKey,
          label: flowLabel(blocking.flowKey),
          running: blocking.running,
          limit: blocking.limit ?? null,
          queued: blocking.queued,
        });
      });
    };
    // A writer outside a mount_per_item map waits while a map holds the run mounts (P05 §4.1).
    const leased = async (): Promise<void> => {
      const keys = this.deps.leases && this.deps.writerLeaseKeys ? await this.deps.writerLeaseKeys(runId, stageRunId) : [];
      if (keys.length === 0) return admitted();
      // Waiting for a map to hand the mounts back is not waiting for a slot: no queue_timeout meanwhile (MAPWAIT-R9).
      this.leaseWaits.add(stageRunId);
      let release: () => void;
      try {
        release = await this.deps.leases!.acquire(keys, 'write', stageRunId);
      } finally {
        this.leaseWaits.delete(stageRunId);
      }
      try {
        if (entry.dropped) return;
        await admitted();
      } finally {
        release();
      }
    };
    const run = leased()
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

  private async captureIteration(runId: string, stageRunId: string, k: number, at: 'start' | 'end', checkpoint: boolean): Promise<void> {
    const r = this.deps.loops
      ? await this.deps.loops.capture(runId, stageRunId, k, checkpoint && at === 'end')
      : { treeHashes: null, checkpointTurnId: null };
    this.deps.post(runId, { type: 'iteration_captured', stageRunId, k, at, treeHashes: r.treeHashes, checkpointTurnId: r.checkpointTurnId });
  }

  private async restoreIteration(runId: string, stageRunId: string, k: number, checkpointTurnId: string): Promise<void> {
    const r = this.deps.loops
      ? await this.deps.loops.restore(runId, stageRunId, k, checkpointTurnId)
      : { ok: false, error: 'Checkpoints are not available on this server' };
    this.deps.post(runId, { type: 'iteration_restored', stageRunId, k, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
  }

  private async mapSnapshot(runId: string, stageRunId: string): Promise<void> {
    const r = this.deps.maps ? await this.deps.maps.snapshot(runId, stageRunId) : { snapshot: null, error: 'Maps with mount_per_item are not available in this process' };
    this.deps.post(runId, { type: 'map_snapshot_taken', stageRunId, snapshot: r.snapshot, ...(r.error ? { error: r.error } : {}) });
  }

  private async mapPrepareItem(runId: string, stageRunId: string, index: number): Promise<void> {
    const r = this.deps.maps
      ? await this.deps.maps.prepareItem(runId, stageRunId, index)
      : { ok: false as const, code: 'mount_fork_failed', error: 'Maps with mount_per_item are not available in this process' };
    this.deps.post(runId, { type: 'map_item_prepared', stageRunId, index, ...r });
  }

  private async mapMergeItem(runId: string, stageRunId: string, index: number, strategy: 'sequential' | 'pr_per_item'): Promise<void> {
    const r = this.deps.maps
      ? await this.deps.maps.mergeItem(runId, stageRunId, index, strategy)
      : { ok: false as const, code: 'merge_failed', error: 'Map merges are not available in this process' };
    this.deps.post(runId, { type: 'map_item_merged', stageRunId, index, ...r });
  }

  private async startChild(runId: string, stageRunId: string, inputs: Record<string, unknown>): Promise<void> {
    if (!this.deps.subworkflows) {
      this.deps.post(runId, { type: 'child_start_failed', stageRunId, code: 'subworkflow_start_failed', error: 'Sub-workflows are not available in this process' });
      return;
    }
    const r = await this.deps.subworkflows.start(runId, stageRunId, inputs);
    if (r.ok) this.deps.post(runId, { type: 'child_started', stageRunId, childRunId: r.childRunId });
    else this.deps.post(runId, { type: 'child_start_failed', stageRunId, code: r.code, error: r.error });
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

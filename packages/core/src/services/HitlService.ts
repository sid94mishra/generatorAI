// ────────────────────────────────────────────────────────────────
// HitlService — HITL-03 human-in-the-loop interrupt/resume primitive.
//
// Two sides:
//
//   Stage code (producer):
//     const value = await hitl.interrupt(stageRunId, workflowRunId, { ... });
//     // stage body now has the approver-supplied value and continues
//
//   Route / UI / CLI (approver):
//     await hitl.resume(stageRunId, workflowRunId, { approved: true });
//     // any in-memory interrupt() awaiter resolves with that value;
//     // the stage row flips awaiting_input → running
//
// How it survives a crash
// ------------------------
// Persistent state is the `stage_runs.interrupt_data` column. If the
// server dies mid-interrupt the in-memory resolver is lost — but the
// row is still `awaiting_input` on disk. When the server restarts, an
// approver can still POST /resume; the row flips to `running` and the
// DAG scheduler re-picks the stage via its normal ready-stage sweep.
// Stage bodies that want a durable transfer of the approver's value
// should read `stage_runs.interrupt_data.result` (populated by resume)
// on their next execution — this is a one-line convention, not a deep
// framework feature, and matches how most HITL platforms handle it.
//
// Default mode = auto-approve
// ---------------------------
// The product ships with `permission_mode='bypassPermissions'` by default
// (see WorkflowRun schema + `DEFAULT_WORKFLOW_RUN_PERMISSION_MODE`). That
// means HITL code paths never fire without explicit opt-in from either
// the UI mode selector or the CLI permission-mode command. This service
// is always present but inert until opted into.
// ────────────────────────────────────────────────────────────────

import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { EventBus } from '../events/EventBus.js';
import type { StageRun, StageReviewOutcome } from '@generatorai/shared';

/** Value delivered back to an awaiting `interrupt()` caller on resume. */
export interface InterruptResolution {
  /**
   * Legacy two-state verdict. Kept as the primary field so every existing
   * caller and API client keeps working unchanged.
   */
  approved: boolean;
  /**
   * Tri-state verdict. When absent it is derived from {@link approved}
   * (`true` → `approved`, `false` → `changes_requested`).
   *
   * `rejected` is deliberately NOT reachable from the boolean: rejecting
   * terminates the stage and blocks every downstream stage, so it must be an
   * explicit choice rather than the fallback meaning of "not approved".
   */
  outcome?: StageReviewOutcome;
  value?: unknown;
  reason?: string;
}

/** Normalises a resolution to its tri-state verdict. */
export function resolutionOutcome(resolution: InterruptResolution): StageReviewOutcome {
  if (resolution.outcome) return resolution.outcome;
  return resolution.approved ? 'approved' : 'changes_requested';
}

export interface HitlLogger {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
}

export class HitlService {
  /**
   * Active interrupt awaits keyed by stageRunId. Each entry resolves when
   * a matching `resume()` arrives (same process) or is cleared on stage
   * cancellation. On server restart the map is empty — rows stay
   * `awaiting_input` in the DB and the scheduler re-runs the stage
   * once resumed.
   */
  private readonly waiters = new Map<string, (res: InterruptResolution) => void>();

  constructor(
    private readonly stageRunRepo: IStageRunRepository,
    private readonly eventBus: EventBus,
    private readonly logger?: HitlLogger,
  ) {}

  /**
   * Park the stage and wait for a human approver. Returns the resolution
   * the approver supplied via `resume()`. If a resolver already exists
   * for this stage (shouldn't happen in practice — a stage can only
   * interrupt once at a time), the old one is rejected to prevent a
   * dangling promise.
   */
  async interrupt(
    stageRunId: string,
    workflowRunId: string,
    data: unknown,
    opts?: { prompt?: string },
  ): Promise<InterruptResolution> {
    // Register the waiter SYNCHRONOUSLY before we do any await. That
    // guarantees a caller who immediately `cancelWaiter()`s (e.g. a
    // parent-run cancellation racing with our interrupt call) sees the
    // resolver and doesn't deadlock the returned promise.
    const stale = this.waiters.get(stageRunId);
    if (stale) {
      stale({ approved: false, reason: 'superseded by new interrupt' });
      this.waiters.delete(stageRunId);
    }
    const promise = new Promise<InterruptResolution>((resolve) => {
      this.waiters.set(stageRunId, resolve);
    });

    await this.stageRunRepo.interrupt(stageRunId, data);
    await this.eventBus.emitGlobal({
      kind: 'stage_run.awaiting_input',
      data: {
        stageRunId,
        workflowRunId,
        interruptData: data,
        prompt: opts?.prompt,
      },
    });
    this.logger?.info?.('[HITL] stage awaiting_input', {
      stageRunId,
      workflowRunId,
    });

    return promise;
  }

  /**
   * Approver-side resume. Flips status atomically, emits the event, and
   * — if an in-memory awaiter exists — resolves it. Returns
   * `{ok: false, reason}` when the row isn't awaiting_input (already
   * resumed / cancelled / other process won the race).
   */
  async resume(
    stageRunId: string,
    workflowRunId: string,
    resolution: InterruptResolution,
  ): Promise<{ ok: boolean; reason?: string }> {
    const ok = await this.stageRunRepo.resumeFromInterrupt(stageRunId);
    if (!ok) {
      return {
        ok: false,
        reason: 'stage was not awaiting_input (already resumed, cancelled, or claimed by another approver)',
      };
    }

    // Persist the resolver's value inside interrupt_data.result so a
    // post-restart re-run of the stage can still read it. Done as a
    // follow-up update rather than piggybacked on resumeFromInterrupt
    // because the atomic SQL there clears the column; writing it back
    // keeps the DB surface narrow.
    if (resolution.value !== undefined) {
      await this.stageRunRepo.update(stageRunId, {
        interruptData: {
          result: resolution.value,
          approved: resolution.approved,
          reason: resolution.reason,
          resumedAt: Date.now(),
        },
      });
    }

    await this.eventBus.emitGlobal({
      kind: 'stage_run.input_received',
      data: {
        stageRunId,
        workflowRunId,
        value: resolution.value,
      },
    });

    const waiter = this.waiters.get(stageRunId);
    if (waiter) {
      this.waiters.delete(stageRunId);
      waiter(resolution);
    }
    this.logger?.info?.('[HITL] stage resumed from awaiting_input', {
      stageRunId,
      approved: resolution.approved,
    });
    return { ok: true };
  }

  /** Cancel an awaiter (e.g. when the parent run is cancelled). Safe no-op if none. */
  cancelWaiter(stageRunId: string, reason: string): void {
    const waiter = this.waiters.get(stageRunId);
    if (!waiter) return;
    this.waiters.delete(stageRunId);
    waiter({ approved: false, reason });
  }

  /** Read-through to the repository — used by routes / UI / CLI queues. */
  async listPending(workflowRunId: string): Promise<StageRun[]> {
    return this.stageRunRepo.findAwaitingInputByRun(workflowRunId);
  }

  /** Number of in-memory awaiters (test / ops introspection). */
  get activeWaiterCount(): number {
    return this.waiters.size;
  }
}

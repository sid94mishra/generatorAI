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
//     await hitl.resume(stageRunId, workflowRunId, { outcome: 'approved' });
//     // the interrupt() awaiter resolves with that value;
//     // the stage row flips awaiting_input → running
//
// How it survives a crash (P0-a)
// ------------------------------
// Persistent state is the `stage_runs.interrupt_data` column. If the
// server dies mid-interrupt, the row is still `awaiting_input` on disk,
// and `StartupRecoveryService` deliberately leaves it that way — an
// approval that has not happened yet must stay parked.
//
// What matters is where the row goes when the approval finally arrives.
// `resume()` looks for an in-process `interrupt()` awaiter:
//
//   • One exists (same process) → `awaiting_input → running`. The live
//     stage frame is resumed by the resolved promise and carries on.
//
//   • None exists (the approval arrived after a restart — the frame died
//     with the process) → `awaiting_input → pending`, plus a re-drive of
//     the parent run. `pending` is the ONLY status the DAG scheduler's
//     ready sweep considers, so this is what actually gets the stage
//     relaunched. The verdict is durably recorded on the row as
//     `interrupt_data.result` and held in memory for the relaunched
//     stage's next `interrupt()` on the same gate, which returns it
//     instead of parking a second time — so the human approves once.
//
// Before this, resume() always wrote `running`, which no scheduler path
// looks at: nothing relaunched the stage and the run sat in `running`
// forever. Note this is a re-EXECUTION of the stage, not a resumption of
// its old stack frame — the at-least-once baseline every other stage
// status already gets after a restart (see `StartupRecoveryService`).
// Stage bodies wanting the approver's value without re-parking can also
// read `stage_runs.interrupt_data.result`, which resume() always writes.
//
// W22 — the wait itself is now backed by `DurableExecutionEngine`'s
// Awakeable primitive when one is supplied (every real deployment: the
// server always constructs it — see `createCoreServices.ts`). Previously
// `interrupt()` parked on a bare in-memory `Map<stageRunId, resolve>`
// with NO durable record and NO timeout at all (LINT-HAZ-4 requires one),
// meaning an approval could hang a process thread's microtask forever and
// left nothing for `DurableExecutionEngine` to actually be used for in
// production. The Awakeable token is persisted to `interrupt_data`
// alongside the reviewer-facing payload, so `resume()` can resolve it
// even in a fresh process (the DB row, not process memory, is now the
// source of truth for "does an awakeable exist for this stage").
//
// What this still does NOT close: the relaunched stage re-runs its
// prompts, tool calls and hooks from the top — the gate is replayed for
// free, the work before it is not. Making that replay cheap and
// side-effect-free is W22's full "effect sandwich" scope (§3.4): every
// earlier step would have to run through `withEffect()`. That is a much
// larger, higher-risk change to the live turn-execution path and is
// intentionally left for its own pass.
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
import type { DurableExecutionEngine } from './DurableExecutionEngine.js';

/**
 * W22 — how long an approval Awakeable stays alive before timing out.
 * The engine's own primitive default (LINT-HAZ-4) is 24h, chosen for
 * generic mid-run steering; a human approval can reasonably span a
 * weekend, so HITL overrides it to 30 days rather than accepting a
 * timeout that would fail real workflows. A timeout here fails the stage
 * loudly (via the rejected promise) instead of the old behaviour of
 * hanging forever with no record anywhere that anything was waiting.
 */
const HITL_AWAKEABLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;

/** Key `interrupt()` stashes its Awakeable token under inside `interrupt_data`. */
const AWAKEABLE_TOKEN_KEY = '__hitlAwakeableToken';

/**
 * P0-a — how long a verdict accepted with no live awaiter is held for the
 * relaunched stage to collect. The relaunch happens within seconds; anything
 * still uncollected after an hour belongs to a stage that failed on its way
 * back to the gate, and holding it would answer a much later, unrelated
 * approval request.
 */
const POST_RESTART_VERDICT_TTL_MS = 60 * 60 * 1000;

/** Value delivered back to an awaiting `interrupt()` caller on resume. */
export interface InterruptResolution {
  /**
   * The verdict. `rejected` terminates the stage and blocks every downstream
   * stage; `changes_requested` sends feedback and re-parks; a cancelled or
   * superseded wait resolves as `rejected` with a reason.
   */
  outcome: StageReviewOutcome;
  value?: unknown;
  reason?: string;
}

export interface HitlLogger {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Merge an Awakeable token into whatever `data` the caller passed to `interrupt()`. */
function withAwakeableToken(data: unknown, token: string): Record<string, unknown> {
  const base = data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { value: data };
  return { ...base, [AWAKEABLE_TOKEN_KEY]: token };
}

/** Pull a previously-stashed Awakeable token back out of `interrupt_data`, if present. */
function extractAwakeableToken(interruptData: unknown): string | undefined {
  const record = asRecord(interruptData);
  const token = record?.[AWAKEABLE_TOKEN_KEY];
  return typeof token === 'string' ? token : undefined;
}

/** Narrow to a plain object, or undefined for anything else (null, array, scalar). */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * The gate an interrupt payload belongs to, when it declares one. Stage-level
 * approval uses `kind: 'stage_completion_review'`; the harness permission
 * bridge uses its own. A verdict stashed for one gate must never be consumed
 * by a different gate the relaunched stage happens to hit first.
 */
function interruptKind(data: unknown): string | undefined {
  const kind = asRecord(data)?.['kind'];
  return typeof kind === 'string' ? kind : undefined;
}

/** Shape of a verdict parked on the row for a post-restart relaunch. */
interface PendingResolutionRecord {
  resolution: InterruptResolution;
  /** Gate this verdict answers — see {@link interruptKind}. */
  kind?: string;
  resumedAt: number;
}

export class HitlService {
  /**
   * W22 — stageRunId → its current Awakeable token. Lets `cancelWaiter()`/a superseding `interrupt()` find the
   * right token to resolve without re-reading the DB row.
   */
  private readonly stageAwakeableTokens = new Map<string, string>();
  /**
   * P0-a — stageRunId → a verdict `resume()` accepted when no `interrupt()`
   * frame was alive to take it (the approval arrived after a restart). The
   * relaunched stage's `interrupt()` collects it instead of re-asking.
   */
  private readonly postRestartVerdicts = new Map<string, PendingResolutionRecord>();

  constructor(
    private readonly stageRunRepo: IStageRunRepository,
    private readonly eventBus: EventBus,
    /** W22 — every wait is a durable Awakeable. */
    private readonly durableEngine: DurableExecutionEngine,
    private readonly logger?: HitlLogger,
    /** Override for `HITL_AWAKEABLE_TIMEOUT_MS` — tests only; production always uses the 30-day default. */
    private readonly awakeableTimeoutMs: number = HITL_AWAKEABLE_TIMEOUT_MS,
    /**
     * P0-a — re-drive callback, wired to `WorkflowRunService.redriveRun`.
     * Called when an approval arrives with no live awaiter (post-restart), so
     * the stage this method just returned to `pending` is actually relaunched
     * rather than waiting for whatever happens to sweep the run next. Omitted
     * in embeddings without a run service; the stage is still `pending`, so a
     * later sweep or an explicit run resume picks it up.
     */
    private onRedriveRun?: (workflowRunId: string) => Promise<void>,
  ) {}

  /**
   * Late-bind the re-drive callback. `WorkflowRunService` is constructed after
   * this service (it depends on `StageExecutionService`, which depends on us),
   * so the wiring cannot go through the constructor.
   */
  setRedriveRun(fn: (workflowRunId: string) => Promise<void>): void {
    this.onRedriveRun = fn;
  }

  /**
   * P0-a — consume a verdict `resume()` accepted while no `interrupt()` frame
   * existed to receive it, so the relaunched stage does not ask the same human
   * the same question again.
   *
   * Deliberately SYNCHRONOUS and in-memory. `interrupt()` must park the row
   * before it yields — callers (and `cancelWaiter`) rely on
   * `awaiting_input` being visible the moment `interrupt()` returns its
   * promise — so this cannot be a repository read. It does not need to be:
   * the approval, the re-drive and the relaunched stage's re-park all happen
   * in the process that served the approval, within seconds. If THAT process
   * also dies in between, the verdict is still durably on the row as
   * `interrupt_data.result` and the gate re-opens — one extra approval, not
   * lost work.
   *
   * Only a verdict for the SAME gate is consumed: a stage can park on more
   * than one kind of interrupt (stage_completion_review, the harness
   * permission bridge), and an approval for one must never silently answer
   * another.
   */
  private takePendingResolution(stageRunId: string, data: unknown): InterruptResolution | undefined {
    const parked = this.postRestartVerdicts.get(stageRunId);
    if (!parked || parked.kind !== interruptKind(data)) return undefined;
    this.postRestartVerdicts.delete(stageRunId);
    this.logger?.info?.('[HITL] applying a verdict approved before the stage was relaunched', {
      stageRunId,
      outcome: parked.resolution.outcome,
    });
    return parked.resolution;
  }

  /** Drop verdicts whose stage never came back to collect them. */
  private prunePostRestartVerdicts(): void {
    const cutoff = Date.now() - POST_RESTART_VERDICT_TTL_MS;
    for (const [stageRunId, parked] of this.postRestartVerdicts) {
      if (parked.resumedAt < cutoff) this.postRestartVerdicts.delete(stageRunId);
    }
  }

  /**
   * Park the stage and wait for a human approver. Returns the resolution
   * the approver supplied via `resume()`.
   *
   * W22 — the wait is backed by a durable Awakeable rather than a bare
   * in-memory Promise: the token is persisted to `interrupt_data`, so
   * `resume()` can resolve it correctly even from a fresh process, and the
   * wait has a real timeout (`HITL_AWAKEABLE_TIMEOUT_MS`).
   */
  async interrupt(
    stageRunId: string,
    workflowRunId: string,
    data: unknown,
    opts?: { prompt?: string },
  ): Promise<InterruptResolution> {
    // P0-a — this stage may be a relaunch of one that was already approved
    // while its previous frame was dead. Take that verdict rather than asking
    // the same human the same question a second time. Synchronous, so the
    // ordinary path still parks the row before this method first yields.
    const alreadyDecided = this.takePendingResolution(stageRunId, data);
    if (alreadyDecided) return alreadyDecided;

    // A stage can only interrupt once at a time — supersede any stale
    // awakeable.
    const staleToken = this.stageAwakeableTokens.get(stageRunId);
    if (staleToken) {
      this.durableEngine.resolveAwakeable(staleToken, { outcome: 'rejected', reason: 'superseded by new interrupt' });
      this.stageAwakeableTokens.delete(stageRunId);
    }

    const { token, promise: awakeablePromise } = this.durableEngine.createAwakeable(
      { scope: 'stage_run', scopeId: stageRunId },
      this.awakeableTimeoutMs,
    );
    this.stageAwakeableTokens.set(stageRunId, token);
    const effectiveData = withAwakeableToken(data, token);
    const promise = awakeablePromise
      .then((payload) => payload as InterruptResolution)
      .finally(() => {
        // Only clear if we're still the current token — a superseding
        // interrupt() may have already replaced it in the map.
        if (this.stageAwakeableTokens.get(stageRunId) === token) {
          this.stageAwakeableTokens.delete(stageRunId);
        }
      });

    await this.stageRunRepo.interrupt(stageRunId, effectiveData);
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
   * resolves the pending durable Awakeable (works even in a fresh process,
   * since the token travels through the DB row, not process memory). Returns `{ok: false, reason}` when the row isn't
   * awaiting_input (already resumed / cancelled / other process won the
   * race).
   */
  async resume(
    stageRunId: string,
    workflowRunId: string,
    resolution: InterruptResolution,
  ): Promise<{ ok: boolean; reason?: string }> {
    // W22 — read the token (and the parked payload's gate) BEFORE
    // resumeFromInterrupt, which clears interrupt_data as part of its
    // atomic transition.
    let awakeableToken: string | undefined;
    let parkedKind: string | undefined;
    try {
      const stage = await this.stageRunRepo.getById(stageRunId);
      parkedKind = interruptKind(stage.interruptData);
      awakeableToken = extractAwakeableToken(stage.interruptData);
    } catch {
      // Row not found or unreadable — resumeFromInterrupt below will
      // correctly report ok:false; nothing to resolve either way.
    }

    // P0-a — is the stage frame that called `interrupt()` still alive in this
    // process? That, not the presence of a durable record, decides where the
    // row goes: a live frame continues (`running`), a dead one has to be
    // relaunched, and only `pending` is relaunchable.
    const hasLiveWaiter = this.stageAwakeableTokens.has(stageRunId);

    const ok = await this.stageRunRepo.resumeFromInterrupt(
      stageRunId,
      hasLiveWaiter ? 'running' : 'pending',
    );
    if (!ok) {
      return {
        ok: false,
        reason: 'stage was not awaiting_input (already resumed, cancelled, or claimed by another approver)',
      };
    }

    // Persist the verdict inside interrupt_data.result — the documented
    // read-it-on-the-next-execution convention. Now written unconditionally:
    // it used to be skipped when `resolution.value` was undefined, which is
    // the common "approve, no payload" case, so the one durable trace of the
    // decision was missing exactly when a relaunched stage needed it. Written
    // as a follow-up update rather than piggybacked on resumeFromInterrupt
    // because the atomic SQL there clears the column; writing it back keeps
    // the DB surface narrow.
    const resumedAt = Date.now();
    await this.stageRunRepo.update(stageRunId, {
      interruptData: {
        result: resolution.value,
        outcome: resolution.outcome,
        reason: resolution.reason,
        resumedAt,
      },
    });

    // P0-a — nobody is waiting on this verdict in memory, so hold it for the
    // relaunched stage to collect when it reaches the same gate again.
    if (!hasLiveWaiter) {
      this.prunePostRestartVerdicts();
      this.postRestartVerdicts.set(stageRunId, {
        resolution,
        ...(parkedKind ? { kind: parkedKind } : {}),
        resumedAt,
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

    if (awakeableToken) {
      // Durable path. Succeeds whether or not a live in-process subscriber
      // exists — the entries-table row is marked resolved either way, which
      // is the whole point: a fresh process (this one, if the original
      // interrupt() call happened before a restart) can still record the
      // approval correctly rather than silently discarding it.
      this.durableEngine.resolveAwakeable(awakeableToken, resolution);
      this.stageAwakeableTokens.delete(stageRunId);
    }
    this.logger?.info?.('[HITL] stage resumed from awaiting_input', {
      stageRunId,
      outcome: resolution.outcome,
      relaunched: !hasLiveWaiter,
    });

    // P0-a — no live frame to continue, so the stage is back in `pending` and
    // something has to pick it up. Awaited rather than fire-and-forget: the
    // approver's HTTP response should not claim success if the relaunch threw.
    if (!hasLiveWaiter && this.onRedriveRun) {
      try {
        await this.onRedriveRun(workflowRunId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.warn?.('[HITL] stage approved but the run re-drive failed', {
          stageRunId,
          workflowRunId,
          error: message,
        });
        return {
          ok: false,
          reason: `approval recorded, but re-driving run ${workflowRunId} failed: ${message}`,
        };
      }
    }
    return { ok: true };
  }

  /** Cancel an awaiter (e.g. when the parent run is cancelled). Safe no-op if none. */
  cancelWaiter(stageRunId: string, reason: string): void {
    // A cancelled stage will never come back to collect a held verdict, and
    // leaving one would answer a later, unrelated gate on the same row.
    this.postRestartVerdicts.delete(stageRunId);
    const token = this.stageAwakeableTokens.get(stageRunId);
    if (!token) return;
    this.durableEngine.resolveAwakeable(token, { outcome: 'rejected', reason });
    this.stageAwakeableTokens.delete(stageRunId);
  }

  /** Read-through to the repository — used by routes / UI / CLI queues. */
  async listPending(workflowRunId: string): Promise<StageRun[]> {
    return this.stageRunRepo.findAwaitingInputByRun(workflowRunId);
  }

  /** Number of active durable-Awakeable awaiters (test / ops introspection). */
  get activeWaiterCount(): number {
    return this.stageAwakeableTokens.size;
  }
}

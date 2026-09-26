// ────────────────────────────────────────────────────────────────
// StageExecutor — one attempt of one agent stage (P03 WP-3.5, G5 §3.3–3.4,
// §5.6, §5.9).
//
// State ownership (the handoff contract): the executor owns the in-attempt
// transitions, each a CAS on `stage_runs` —
//   ready → starting (the claim, with a lease), starting → running,
//   running → validating, validating → running (a repair, or the approval
//   gate), running → awaiting_input → running (a human gate with a live
//   frame).
// Everything else is the actor's. The two meet only through CAS, so the
// loser stops: a pause or cancel is written by the actor BEFORE it aborts
// the executor, the executor's next CAS or status re-check fails, and it
// writes nothing more (B-3, F-1, O-9). Success is reported from
// `validating` only, once the output contract held (F-5).
//
// Every turn
//   - is journalled (`ITurnJournal`): the intent and the user message in one
//     transaction, the settlement and the assistant message (`complete = 1`)
//     in another. A turn with no settlement is interrupted, whatever it
//     streamed (RV-10); a resume attempt re-sends it, a settled one replays;
//   - runs inside the attempt deadline, internal turns included (B-8,
//     F-14), and feeds the idle watchdog from harness events; human wait
//     time counts toward neither (B-7);
//   - is followed by a status re-check.
// Provider failures cross into the engine through `toHarnessError` and are
// classified (`classifyStageError`); the attempt reports one
// `attempt_settled` message to the actor and never writes a terminal state.
//
// The stage conversation (P03b, `StageConversationService`): an operator
// message sent between two turns is queued on the frame and sent as the
// next `operator` turn; a stop ends the turn in flight without failing the
// stage (chat parity); a message to a COMPLETED stage amends its output on
// the same session key (PD-4): no status change, successors not re-run.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentEvent, ExecutionWorkspace, ILogger, ResolvedAgentProjection, Session, WorkflowRun } from '@generatorai/shared';
import { DEFAULT_AGENT_MODE, generateId } from '@generatorai/shared';
import {
  renderTemplate,
  resolveSessionSpec,
  STAGE_DEFAULTS,
  templateVariableNames,
  type AgentMode,
  type AgentStage,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import { classifyStageError, classified, StageError } from '../../domain/errors/StageError.js';
import type { EngineStores, SettledTurn, TurnReplayPolicy, TurnRole } from '../../domain/ports/IEngineStore.js';
import type { AttachmentRef, IAgentHarness, SendPromptOptions } from '../../domain/ports/IAgentHarness.js';
import type { ISessionRepository } from '../../domain/ports/IRepositories.js';
import type { IScriptRunner } from '../../domain/ports/IScriptRunner.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import type { HostToolsLevel, StructuredOutputLevel } from '../../domain/ports/IProviderInstance.js';
import { expressionScope } from '../../domain/scheduler/readiness.js';
import type { ApprovalVerdict, AttemptMode, AttemptOutcome, InstanceState, OperatorTurn, RunMessage, RunState, StageOutput, Usage } from '../../domain/scheduler/types.js';
import type { EventBus } from '../../events/EventBus.js';
import type { AdmissionTicket } from '../AdmissionController.js';
import { redactProjection } from '../AgentResolver.js';
import { replayPolicyForToolGroups } from '../DurableExecutionEngine.js';
import type { RunDefinitionReader } from '../definitions/RunDefinitionReader.js';
import { userVariables } from '../definitions/runScope.js';
import type { InterruptResolution } from '../session/StageGatePort.js';
import type { HookContext, HookExecutor } from '../HookExecutor.js';
import type { PlanService } from '../PlanService.js';
import type { WorkspaceCheckpointService } from '../WorkspaceCheckpointService.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import { resolverLayer } from '../session/agentProjection.js';
import { appendTools } from '../session/cfg.js';
import { capabilityLevelsFor } from '../session/capabilityLevels.js';
import { runPermissionSource, type PermissionModeSource } from '../session/permissionSource.js';
import { rememberProviderSession } from '../session/providerSession.js';
import type { ComposeResult, SessionComposer } from '../session/SessionComposer.js';
import { StageGatePort } from '../session/StageGatePort.js';
import { TurnRecorder } from '../session/TurnRecorder.js';
import type { SessionOwner, TurnContext } from '../session/types.js';
import { runWorkspace, workspaceExposure } from '../session/workspaceExposure.js';
import { StageConversationError } from './StageConversationError.js';
import {
  checkOutputContract,
  chooseStrategies,
  createSubmitOutputTool,
  repairMessage,
  type ExtractionStrategy,
  type OutputContractInput,
  type TurnOutputs,
} from './OutputExtractor.js';

/** What the effects layer hands the executor: the attempt the actor created. */
export interface LaunchRequest {
  runId: string;
  stageRunId: string;
  attemptNo: number;
}

/** Why the actor stopped an attempt (the `abort` decision's reason). */
export type AbortReason = 'cancel' | 'pause' | 'budget' | 'loser' | 'queue_timeout';

export interface ExecutorTiming {
  /** Lease stamped by the claim and every renewal (G5 §5.6: 60 s). */
  leaseTtlMs: number;
  /** Lease renewal period while the frame is alive (20 s). */
  renewEveryMs: number;
  /** `last_progress_at` writes, at most one per period (10 s). */
  progressEveryMs: number;
  /** Deadline check and idle watchdog period. */
  watchdogTickMs: number;
  /** Agent time per attempt when the stage declares no `timeouts.attemptMs`. */
  defaultAttemptMs: number;
}

export const DEFAULT_EXECUTOR_TIMING: ExecutorTiming = {
  leaseTtlMs: 60_000,
  renewEveryMs: 20_000,
  progressEveryMs: 10_000,
  watchdogTickMs: 1_000,
  defaultAttemptMs: 30 * 60_000,
};

export interface StageExecutorDeps {
  /** This process's boot id: the owner of every lease it stamps. */
  bootId: string;
  stores: EngineStores;
  /** The run row: pinned version, variables, the permission layer. */
  runRepo: IWorkflowRunRepository;
  definitions: RunDefinitionReader;
  harness: IAgentHarness;
  composer: SessionComposer;
  sessionRepo: ISessionRepository;
  eventBus: EventBus;
  workspaceManager: WorkspaceManager;
  hookExecutor?: HookExecutor | undefined;
  checkpoints?: WorkspaceCheckpointService | undefined;
  planService?: PlanService | undefined;
  scriptRunner?: IScriptRunner | undefined;
  /**
   * The harness boundary (P03 WP-3.4): a provider failure becomes a
   * `HarnessError` (`toHarnessError` of `@generatorai/agent-harness-providers`).
   */
  toHarnessError?: ((provider: string | undefined, raw: unknown) => unknown) | undefined;
  /** Files uploaded to a stage (the stage conversation API's attachments). */
  artifacts?: StageArtifactReader | undefined;
  /** Deliver a message to the run's actor. */
  post: (runId: string, msg: RunMessage) => void;
  logger?: ILogger | undefined;
  now?: () => number;
  timing?: Partial<ExecutorTiming>;
}

/** The artifact rows an operator turn's attachments resolve through. */
export interface StageArtifactReader {
  getArtifact(id: string): Promise<{ id: string; name: string; path: string; mimeType?: string | null; sessionId: string; stageRunId?: string | null } | null>;
}

/** Whether a stage can take an operator message right now (the stage conversation API). */
export type StageFrameState =
  /** No frame in this process. */
  | 'none'
  /** A turn is in flight (PD-3: refused). */
  | 'mid_turn'
  /** Between turns: a message is queued as the next operator turn. */
  | 'between_turns'
  /** The attempt already took its last turn: it is reporting its outcome. */
  | 'closing';

/** Ends the attempt early with an outcome (an abort, a lost CAS, a watchdog). */
class AttemptStop extends Error {
  constructor(readonly outcome: AttemptOutcome) {
    super(outcome.kind === 'failed' ? outcome.error.message : `attempt ${outcome.kind}`);
  }
}

/** An operator stopped the turn while it waited on an in-turn gate: the gate answers as cancelled. */
class TurnStoppedAtGate extends Error {}

interface Waiter {
  resolve: (verdict: ApprovalVerdict | null) => void;
}

interface Frame {
  req: LaunchRequest;
  owner: string;
  ac: AbortController;
  /** Set by `abort()` or a watchdog: how the attempt ends. */
  stop?: AttemptOutcome;
  conversationId?: string;
  /** `run_sessions.session_key` once the session is bound (a session group's amend check). */
  sessionKey?: string;
  ticket?: AdmissionTicket | undefined;
  waiter?: Waiter;
  /** A verdict carried by a resume attempt (approval given with no frame, after a restart). */
  carriedVerdict?: ApprovalVerdict;
  startedAt: number;
  parkedMs: number;
  parkedSince?: number;
  lastProgressAt: number;
  lastProgressWrite: number;
  turnInFlight: boolean;
  /** The turn in flight's own abort (a stop ends the turn, not the attempt). */
  turnAc?: AbortController;
  /** Set by `cancelTurn`: the turn in flight ends as a stopped turn. */
  turnStop?: { force: boolean };
  /** Operator messages waiting for the next turn boundary. */
  operatorQueue: OperatorTurn[];
  /** The attempt took its last turn: new operator messages are refused. */
  closed: boolean;
  /** An amendment of a completed instance (no attempt, no lease, no status change). */
  amend: boolean;
  timers: Array<ReturnType<typeof setInterval>>;
  unsubscribe?: () => void;
}

/** Everything an attempt body needs once the instance is claimed. */
interface AttemptContext {
  frame: Frame;
  run: WorkflowRun;
  graph: WorkflowGraph;
  stage: AgentStage;
  state: RunState;
  instance: InstanceState;
  mode: AttemptMode;
  /** The attempt whose journal this one continues: its own number unless it resumes. */
  epoch: number;
  agentMode: AgentMode;
  variables: Record<string, unknown>;
  workspace: ExecutionWorkspace;
  workDir: string;
  permissionSource: PermissionModeSource;
  session?: Session;
  composed?: ComposeResult;
  owner?: SessionOwner;
  recorder: TurnRecorder;
  replayPolicy: TurnReplayPolicy;
  strategies: ExtractionStrategy[];
  contract: OutputContractInput;
  outputs: TurnOutputs;
  /** The latest answer of the prompt, repair and revision turns: what rules and successors see. */
  outputText: string;
  /** Submissions accepted during the turn in flight. */
  submittedThisTurn: unknown[];
  /** A recap for a conversation that lost its history (sent in front of the next live turn). */
  recap?: string;
  /** A forced stop tore the conversation down: re-bind it before the next turn. */
  rebind?: boolean;
  hookContext: string[];
}

const RESUME_NOTICE =
  'The previous request for this step was interrupted before it finished. Continue from where you stopped; do not redo steps that are already done.\n\n';

/** Short, stable digest of a human's feedback (an operation id of a review round). */
function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function fenceContext(blocks: string[]): string {
  return `<generatorai:stage-context trust="untrusted">\n${blocks.join('\n\n---\n\n')}\n</generatorai:stage-context>\n\n`;
}

function asUsage(data: Record<string, unknown>): Usage {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const cost = n(data['cost']) ?? n(data['costUsd']);
  return {
    turns: 1,
    ...(cost !== undefined ? { costUsd: cost } : {}),
    ...(n(data['inputTokens']) !== undefined ? { inputTokens: n(data['inputTokens'])! } : {}),
    ...(n(data['outputTokens']) !== undefined ? { outputTokens: n(data['outputTokens'])! } : {}),
  };
}

/** The attempt that started this one's journal epoch: walk back over `resume` attempts. */
export function journalEpoch(attempts: ReadonlyArray<{ attemptNo: number; mode: AttemptMode }>, attemptNo: number): number {
  const byNo = new Map(attempts.map((a) => [a.attemptNo, a.mode]));
  let n = attemptNo;
  while (n > 1 && byNo.get(n) === 'resume') n -= 1;
  return n;
}

export class StageExecutor {
  private readonly frames = new Map<string, Frame>();
  private readonly timing: ExecutorTiming;
  private readonly now: () => number;

  constructor(private readonly deps: StageExecutorDeps) {
    this.timing = { ...DEFAULT_EXECUTOR_TIMING, ...(deps.timing ?? {}) };
    this.now = deps.now ?? Date.now;
  }

  /** Late wiring (the composition root builds checkpoints after the engine). */
  setCheckpoints(checkpoints: WorkspaceCheckpointService): void {
    this.deps.checkpoints = checkpoints;
  }

  /** Whether this process has a live frame for the instance (recovery and the actor's deliveries). */
  hasFrame(stageRunId: string, attemptNo?: number): boolean {
    const f = this.frames.get(stageRunId);
    return !!f && (attemptNo === undefined || f.req.attemptNo === attemptNo);
  }

  /** Frames alive in this process. */
  get liveFrames(): number {
    return this.frames.size;
  }

  /**
   * Stop an attempt. The actor wrote the desired state first; this makes the
   * in-flight turn return, and every later CAS of the frame fails.
   */
  abort(stageRunId: string, attemptNo: number, reason: AbortReason): void {
    const f = this.frames.get(stageRunId);
    if (!f || f.req.attemptNo !== attemptNo) return;
    this.stopFrame(f, {
      kind: 'aborted',
      reason: reason === 'pause' ? 'pause' : reason === 'budget' ? 'budget' : 'cancel',
    });
  }

  /** A verdict for a frame parked in `awaiting_input` (the `deliver_input` effect). */
  deliverInput(stageRunId: string, attemptNo: number, verdict: ApprovalVerdict): boolean {
    const f = this.frames.get(stageRunId);
    if (!f || f.req.attemptNo !== attemptNo || !f.waiter) return false;
    const w = f.waiter;
    f.waiter = undefined;
    w.resolve(verdict);
    return true;
  }

  // ── The stage conversation (P03b) ────────────────────────────

  /** Whether the instance can take an operator message now (PD-3: never mid-turn). */
  frameState(stageRunId: string): StageFrameState {
    const f = this.frames.get(stageRunId);
    if (!f) return 'none';
    if (f.stop || f.closed) return 'closing';
    return f.turnInFlight ? 'mid_turn' : 'between_turns';
  }

  /** Queue an operator message for the next turn boundary; false when the frame cannot take it. */
  enqueueOperatorTurn(stageRunId: string, turn: OperatorTurn): boolean {
    const f = this.frames.get(stageRunId);
    if (!f || f.stop || f.closed || f.turnInFlight) return false;
    f.operatorQueue.push(turn);
    return true;
  }

  /**
   * Stop the turn in flight without failing the stage (chat parity): the
   * turn settles with what it produced and the stage carries on from the
   * next turn boundary. A turn parked on an in-turn gate has the gate
   * answered as cancelled first. `force` also tears the provider
   * conversation down; it is re-bound before the next turn. False when no
   * turn is in flight.
   */
  cancelTurn(stageRunId: string, opts: { force?: boolean } = {}): boolean {
    const f = this.frames.get(stageRunId);
    if (!f || f.stop || !f.turnInFlight) return false;
    f.turnStop = { force: opts.force === true };
    if (f.waiter) {
      // An in-turn gate is waiting: it is answered as cancelled (`parkFrame`).
      const w = f.waiter;
      f.waiter = undefined;
      w.resolve(null);
    }
    f.turnAc?.abort();
    if (f.conversationId) {
      const id = f.conversationId;
      void this.deps.harness
        .abortConversation(id)
        .then(() => (opts.force ? this.deps.harness.destroyConversation(id) : undefined))
        .catch(() => undefined);
    }
    return true;
  }

  /**
   * Amend a COMPLETED instance (PD-4, W-55): its conversation is resumed on
   * the session key of its last attempt, the operator turn runs, and the
   * output contract is checked again (with repair turns). The new output
   * replaces the instance's output text/data and stamps `amended_at`; the
   * status stays `completed` and successors are not re-run (the UI offers
   * a fork from here). Resolves once the amendment has started; `done`
   * settles when it ends (an outcome event, `stage_run.amended` or
   * `stage_run.amend_failed`, reports it). A terminal run's conversation
   * is released again afterwards (B-15).
   */
  async amend(runId: string, stageRunId: string, turn: OperatorTurn): Promise<{ done: Promise<void> }> {
    if (this.dead) throw new StageConversationError('ENGINE_UNAVAILABLE', 'The workflow engine is stopping');
    if (this.frames.has(stageRunId)) throw new StageConversationError('STAGE_BUSY', 'The stage is already taking a turn');
    const row = this.deps.stores.stages.getInstance(stageRunId);
    if (!row || row.workflowRunId !== runId) throw new StageConversationError('NOT_FOUND', `No instance ${stageRunId} in run ${runId}`);
    if (row.status !== 'completed') throw new StageConversationError('STAGE_NOT_CONVERSABLE', `Only a completed stage can be amended (it is ${row.status})`);
    const now = this.now();
    const frame: Frame = {
      req: { runId, stageRunId, attemptNo: row.currentAttempt },
      owner: `${this.deps.bootId}:${stageRunId}:amend`,
      ac: new AbortController(),
      startedAt: now,
      parkedMs: 0,
      lastProgressAt: now,
      lastProgressWrite: now,
      turnInFlight: false,
      operatorQueue: [turn],
      closed: false,
      amend: true,
      timers: [],
    };
    // Registered before the first await: a second message is STAGE_BUSY, not a second amendment.
    this.frames.set(stageRunId, frame);
    const release = (): void => {
      for (const t of frame.timers) clearInterval(t);
      frame.timers.length = 0;
      frame.unsubscribe?.();
      if (this.frames.get(stageRunId) === frame) this.frames.delete(stageRunId);
    };
    let ctx: AttemptContext;
    try {
      const attempts = this.deps.stores.attempts.listByStageRun(stageRunId);
      ctx = await this.context(frame, 'resume', journalEpoch(attempts, row.currentAttempt));
      if (ctx.stage.sessionGroup) {
        const key = this.sessionKey(ctx);
        for (const other of this.frames.values()) {
          if (other !== frame && other.req.runId === runId && other.sessionKey === key) {
            throw new StageConversationError('STAGE_BUSY', `The stage's session group "${ctx.stage.sessionGroup}" is in use by another stage`);
          }
        }
      }
    } catch (err) {
      release();
      throw err;
    }
    const done = this.amendBody(ctx)
      .catch(async (err: unknown) => {
        const error = err instanceof AttemptStop ? err.message : classifyStageError(err).message;
        this.logger?.warn(`[StageExecutor] amending ${stageRunId} failed: ${error}`);
        await this.emitSession(ctx, 'stage_run.amend_failed', { error });
      })
      .finally(async () => {
        release();
        await this.releaseAfterAmend(ctx).catch(() => undefined);
      });
    return { done };
  }

  /** Stop every frame (process shutdown): each reports `aborted`. */
  shutdown(): void {
    for (const f of this.frames.values()) this.stopFrame(f, { kind: 'aborted', reason: 'superseded' });
  }

  /**
   * The process is dying (tests simulate a crash with it): drop every frame
   * without a word — no report, no write, timers and listeners gone. The
   * next process's recovery settles what they left behind.
   */
  kill(): void {
    this.dead = true;
    for (const f of this.frames.values()) {
      for (const t of f.timers) clearInterval(t);
      f.timers.length = 0;
      f.unsubscribe?.();
    }
    this.frames.clear();
  }

  private dead = false;

  private stopFrame(f: Frame, outcome: AttemptOutcome): void {
    if (f.stop) return;
    f.stop = outcome;
    f.ac.abort();
    if (f.waiter) {
      const w = f.waiter;
      f.waiter = undefined;
      w.resolve(null);
    }
    if (f.conversationId) void this.deps.harness.abortConversation(f.conversationId).catch(() => undefined);
  }

  /**
   * Run one attempt. Called by the effects layer with an admission slot
   * already granted; never throws. Reports exactly one `attempt_settled`
   * unless the claim was lost (the actor already settled that attempt).
   */
  async start(req: LaunchRequest, ticket?: AdmissionTicket): Promise<void> {
    if (this.dead || this.frames.has(req.stageRunId)) return; // a duplicate launch
    const { stores } = this.deps;
    const now = this.now();
    let owner = `${this.deps.bootId}:${req.stageRunId}:${req.attemptNo}`;
    const claim = stores.stages.transition(req.stageRunId, ['ready'], 'starting', {
      lease: { owner, ttlMs: this.timing.leaseTtlMs },
      // A carried verdict or operator turn now lives on the attempt row (its `overrides`).
      patch: { interruptData: null },
      runId: req.runId,
      now,
    });
    if (!claim.ok) return;
    // Whoever claims runs the instance's live attempt: a launch queued for an
    // attempt the actor has since replaced adopts the current one.
    if (claim.row.currentAttempt !== req.attemptNo) {
      req = { ...req, attemptNo: claim.row.currentAttempt };
      owner = claim.row.leaseOwner ?? owner;
    }
    // The claim ends the admission wait: its queue timeout is moot.
    stores.timers.cancel({ workflowRunId: req.runId, kind: 'queue_timeout', stageRunId: req.stageRunId }, now);

    const frame: Frame = {
      req,
      owner,
      ac: new AbortController(),
      ticket,
      startedAt: now,
      parkedMs: 0,
      lastProgressAt: now,
      lastProgressWrite: now,
      turnInFlight: false,
      operatorQueue: [],
      closed: false,
      amend: false,
      timers: [],
    };
    this.frames.set(req.stageRunId, frame);
    let outcome: AttemptOutcome;
    try {
      outcome = await this.attempt(frame);
    } catch (err) {
      outcome = err instanceof AttemptStop ? err.outcome : frame.stop ?? { kind: 'failed', error: classifyStageError(err) };
    } finally {
      for (const t of frame.timers) clearInterval(t);
      frame.unsubscribe?.();
      if (this.frames.get(req.stageRunId) === frame) this.frames.delete(req.stageRunId);
    }
    if (this.dead) return;
    // A stop wins over whatever the body concluded after it (an aborted turn that resolved).
    if (frame.stop && outcome.kind === 'succeeded') outcome = frame.stop;
    if (frame.operatorQueue.length > 0) {
      // The attempt ended before its next turn boundary: say so rather than drop the messages silently.
      await this.deps.eventBus
        .emitGlobal({
          kind: 'stage_run.operator_message_dropped',
          data: { stageRunId: req.stageRunId, workflowRunId: req.runId, count: frame.operatorQueue.length, outcome: outcome.kind },
        } as unknown as AgentEvent)
        .catch(() => undefined);
    }
    this.deps.post(req.runId, { type: 'attempt_settled', stageRunId: req.stageRunId, attemptNo: req.attemptNo, outcome });
  }

  private get logger(): ILogger | undefined {
    return this.deps.logger;
  }

  // ── The attempt body ─────────────────────────────────────────

  private async attempt(frame: Frame): Promise<AttemptOutcome> {
    const { stores } = this.deps;
    const { runId, stageRunId, attemptNo } = frame.req;
    this.armFrameTimers(frame);

    const attempts = stores.attempts.listByStageRun(stageRunId);
    const attempt = attempts.find((a) => a.attemptNo === attemptNo);
    if (!attempt || attempt.status !== 'running') throw new AttemptStop({ kind: 'aborted', reason: 'superseded' });
    const carried = attempt.overrides as { verdict?: ApprovalVerdict; operatorTurn?: OperatorTurn } | null;
    if (carried?.verdict) frame.carriedVerdict = carried.verdict;
    // A message sent to the paused stage (the retry's `promptOverride`) is its next operator turn.
    if (carried?.operatorTurn) frame.operatorQueue.push(carried.operatorTurn);

    const ctx = await this.context(frame, attempt.mode, journalEpoch(attempts, attemptNo));
    const { stage, workspace } = ctx;

    // A restart starts from the attempt-1 checkpoint (G5 §3.3).
    if (ctx.mode === 'restart' && (stage.retry?.restoreCheckpointOnRestart ?? true) && this.deps.checkpoints) {
      await this.deps.checkpoints
        .restoreTurn(workspace.id, `attempt:${stageRunId}:1`, { workflowRunId: runId }, 'before')
        .catch((err: unknown) => this.logger?.warn(`[StageExecutor] checkpoint restore failed: ${String(err)}`));
    }

    await this.preRunHooks(ctx);
    await this.bindSession(ctx);
    await this.captureCheckpoint(ctx);

    // starting → running: the session is ready.
    const running = stores.stages.transition(stageRunId, ['starting'], 'running', {
      lease: { owner: frame.owner, ttlMs: this.timing.leaseTtlMs },
      patch: { sessionId: ctx.session!.id, sessionKey: this.sessionKey(ctx) },
      runId,
      now: this.now(),
    });
    if (!running.ok) throw new AttemptStop(frame.stop ?? { kind: 'aborted', reason: 'superseded' });
    await this.emitSession(ctx, 'stage_run.running', {
      sessionId: ctx.session!.id,
      name: stage.name,
      stageKey: stage.key,
      instancePath: ctx.instance.instancePath,
      attemptNo,
      version: running.row.version,
    });

    await this.promptTurns(ctx);
    const output = await this.validateAndReview(ctx);
    await this.postRunHooks(ctx);
    return { kind: 'succeeded', output };
  }

  /** The run, the pinned stage and everything an attempt (or an amendment) body needs. */
  private async context(frame: Frame, mode: AttemptMode, epoch: number): Promise<AttemptContext> {
    const { stores } = this.deps;
    const { runId, stageRunId } = frame.req;
    const run = await this.deps.runRepo.getById(runId);
    const graph = await this.deps.definitions.get(run.definitionVersionId);
    const state = stores.runStore.loadRunState(runId);
    const instance = state?.instances.find((i) => i.id === stageRunId);
    if (!state || !instance) throw new StageError('config_invalid', `Instance ${stageRunId} of run ${runId} does not exist`);
    const stage = graph.stages.find((s) => s.key === instance.stageKey) as AgentStage | undefined;
    if (!stage || stage.kind !== 'agent') throw new StageError('config_invalid', `Stage ${instance.stageKey} is not an agent stage of the pinned version`);

    const spec = resolveSessionSpec(graph.workflow.session, stage.session);
    const workspace = await runWorkspace(this.deps.workspaceManager, run);
    const pinned = typeof run.variables?.['__workingDirectory'] === 'string' ? (run.variables['__workingDirectory'] as string) : undefined;
    const ctx: AttemptContext = {
      frame,
      run,
      graph,
      stage,
      state,
      instance,
      mode,
      epoch,
      agentMode: spec.defaultAgentMode ?? DEFAULT_AGENT_MODE,
      // W-41: hook-injected variables are scoped to this attempt, never the run's object.
      variables: { ...(run.variables ?? {}), ...(run.stageOverrides?.find((o) => o.stageKey === stage.key)?.variables ?? {}) },
      workspace,
      workDir: pinned ?? this.deps.workspaceManager.getWorkingDirectory(workspace),
      permissionSource: runPermissionSource(() => this.deps.runRepo.getById(runId), stage.session, graph.workflow.session),
      recorder: new TurnRecorder(),
      replayPolicy: 'never',
      strategies: [],
      contract: {
        format: stage.output.format,
        schema: stage.output.schema,
        extraction: stage.output.extraction,
        rules: stage.output.rules,
      },
      outputs: { native: [], submitted: [], texts: [] },
      outputText: '',
      submittedThisTurn: [],
      hookContext: [],
    };
    return ctx;
  }

  // ── Session ──────────────────────────────────────────────────

  /** `run_sessions.session_key`: a session group's, else this instance's for the journal epoch. */
  private sessionKey(ctx: AttemptContext): string {
    if (ctx.stage.sessionGroup) return `group:${ctx.stage.sessionGroup}`;
    return `instance:${ctx.instance.instancePath}@${ctx.epoch}`;
  }

  private levelsFor(provider: string | undefined, conversationId?: string): { structuredOutput: StructuredOutputLevel; hostTools: HostToolsLevel; persistent: boolean } {
    const byProvider = capabilityLevelsFor(provider);
    const caps = (conversationId && this.deps.harness.capabilitiesFor?.(conversationId)) || this.deps.harness.capabilities();
    return {
      structuredOutput: byProvider?.structuredOutput ?? caps.structuredOutput,
      hostTools: byProvider?.hostTools ?? caps.hostTools,
      persistent: caps.sessionPersistence === true,
    };
  }

  /**
   * The attempt's conversation (G5 §3.3, RV-20): a resume keeps the
   * session of its epoch; a restart gets a new key; a session group shares
   * one. When the composed config differs from the one the key was bound
   * with, a same-provider session is re-bound through `resumeConversation`,
   * and another provider gets a fresh session.
   */
  private async bindSession(ctx: AttemptContext): Promise<void> {
    const { stores, harness, composer, sessionRepo } = this.deps;
    const { runId, stageRunId } = ctx.frame.req;
    const key = this.sessionKey(ctx);
    const bound = stores.runSessions.get(runId, key);
    let session: Session | null = null;
    // An amendment resumes the stage's conversation even after the run released it (B-15).
    if (bound && (bound.status === 'active' || ctx.frame.amend)) session = await sessionRepo.getById(bound.sessionId).catch(() => null);

    const create = !session?.conversationId;
    const sessionId = session?.id ?? generateId();
    const conversationId = session?.conversationId ?? `stage-${stageRunId}-${this.now()}`;
    const owner: SessionOwner = {
      kind: 'stage',
      stageRunId,
      workflowRunId: runId,
      workflowDefinitionId: ctx.run.workflowDefinitionId,
      sessionId,
    };
    const snapshot = this.agentSnapshot(ctx);
    const exposure = await workspaceExposure(this.deps.workspaceManager, ctx.workspace, {
      workingDirectory: typeof ctx.variables['__workingDirectory'] === 'string' ? (ctx.variables['__workingDirectory'] as string) : undefined,
    });
    const spec = resolveSessionSpec(ctx.graph.workflow.session, ctx.stage.session);
    const variables = ctx.variables;
    const composed = await composer.compose({
      owner,
      conversationId,
      mode: create ? 'create' : 'resume',
      spec,
      bindingSpec: ctx.stage.session ?? {},
      agent: { baseLayer: resolverLayer(ctx.graph.workflow.session), bindingLayer: resolverLayer(ctx.stage.session) },
      agentSnapshot: snapshot,
      workspace: ctx.workspace,
      exposure,
      projectId: typeof variables['__projectId'] === 'string' ? (variables['__projectId'] as string) : undefined,
      ...(session?.providerSessionId ? { resumeProviderSessionId: session.providerSessionId } : {}),
      attended: true,
      gates: new StageGatePort({
        park: (turn, data, prompt) => this.park(ctx, turn, data, prompt),
        eventBus: this.deps.eventBus,
        planService: this.deps.planService,
        workspaceRoot: ctx.workspace.rootPath,
        harnessTypeOf: () => spec.harnessType ?? 'unknown',
        readPermissionMode: () => ctx.permissionSource.read(),
      }),
      permission: { source: ctx.permissionSource },
      platform: {
        browser: { autoStart: true, reattach: true, ...(spec.browser ? { config: spec.browser as Record<string, unknown> } : {}) },
        computerUse: 'opt_in',
        orchestrator: false,
      },
    });

    // The output contract's strategies decide whether `submit_output` is bound.
    const levels = this.levelsFor(composed.provider, create ? undefined : conversationId);
    const choice = chooseStrategies(ctx.contract, levels, { resumedStartOnly: !create && levels.hostTools === 'start_only' });
    ctx.strategies = choice.strategies;
    if (choice.strategies.includes('tool')) {
      appendTools(composed.params as unknown as Record<string, unknown>, [
        createSubmitOutputTool(ctx.contract.schema, (value) => ctx.submittedThisTurn.push(value)),
      ]);
    }
    const configHash = createHash('sha256').update(`${composed.bindingKey}|${composed.provider ?? ''}|${choice.strategies.join(',')}`).digest('hex').slice(0, 16);

    if (create) {
      const at = new Date(this.now());
      await sessionRepo.create({
        id: sessionId,
        name: `Stage session (${stageRunId})`,
        status: 'created',
        tags: [],
        conversationId,
        ownerType: 'stage_run',
        ownerId: stageRunId,
        createdAt: at,
        updatedAt: at,
      });
      await harness.createConversation({ ...composed.params, conversationId });
      await sessionRepo.updateStatus(sessionId, 'active');
      session = { id: sessionId, name: `Stage session (${stageRunId})`, status: 'active', tags: [], conversationId, ownerType: 'stage_run', ownerId: stageRunId, createdAt: at, updatedAt: at };
    } else {
      const live = harness.hasLiveConversation(conversationId);
      if (!live || bound?.configHash !== configHash) {
        // A conversation lost to a restart comes back composed (R4); a
        // changed config is re-bound on the same provider (RV-20).
        await harness.resumeConversation(conversationId, composed.params);
      }
      if (!live && !levels.persistent && !session!.providerSessionId) ctx.recap = await this.recapOf(ctx);
      if (session!.status !== 'active') {
        await sessionRepo.updateStatus(sessionId, 'active');
        session!.status = 'active';
      }
    }
    stores.runSessions.upsert({
      id: bound?.id ?? generateId(),
      workflowRunId: runId,
      sessionKey: key,
      sessionId,
      ownerScopeId: ctx.instance.scopeId,
      configHash,
      now: this.now(),
    });
    stores.attempts.update(stageRunId, ctx.frame.req.attemptNo, {
      sessionId,
      ...(snapshot ? {} : composed.projection.driving ? { agentSnapshot: redactProjection(composed.projection) } : {}),
    });

    ctx.session = session!;
    ctx.composed = composed;
    ctx.owner = owner;
    ctx.frame.conversationId = conversationId;
    ctx.frame.sessionKey = key;
    ctx.replayPolicy = replayPolicyForToolGroups(composed.projection.toolPolicy.groups);
    for (const w of [...composed.warnings.map((x) => ({ code: x.code, message: x.message })), ...choice.warnings.map((m) => ({ code: 'output_extraction', message: m }))]) {
      await this.emitSession(ctx, 'harness.session_info', { infoType: w.code, message: w.message });
    }
    this.listen(ctx);
  }

  /** The frozen agent projection of an earlier attempt of this instance (resume and retry never re-resolve). */
  private agentSnapshot(ctx: AttemptContext): ResolvedAgentProjection | undefined {
    const attempts = this.deps.stores.attempts.listByStageRun(ctx.frame.req.stageRunId);
    for (let i = attempts.length - 1; i >= 0; i--) {
      const s = attempts[i]!.agentSnapshot;
      if (s && typeof s === 'object') return s as ResolvedAgentProjection;
    }
    return undefined;
  }

  /** What the settled turns of this epoch said, for a conversation that lost its history. */
  private async recapOf(ctx: AttemptContext): Promise<string | undefined> {
    const lines: string[] = [];
    for (let i = 0; i < ctx.stage.prompts.length; i++) {
      const e = this.deps.stores.turns.get(ctx.frame.req.stageRunId, `a${ctx.epoch}/prompt/${i}`);
      if (e?.state === 'settled') lines.push(`## Step ${i + 1}\n${e.turn.content}`);
    }
    if (lines.length === 0) return undefined;
    return `This stage resumed on a new session after a restart. The steps below ALREADY COMPLETED; do not redo their work:\n\n${lines.join('\n\n')}\n\n---\n\n`;
  }

  private listen(ctx: AttemptContext): void {
    const { frame } = ctx;
    const conversationId = frame.conversationId!;
    const { runId, stageRunId, attemptNo } = frame.req;
    frame.unsubscribe = this.deps.harness.onConversationEvent(conversationId, async (event: AgentEvent) => {
      ctx.recorder.observe(event);
      const now = this.now();
      frame.lastProgressAt = now;
      if (now - frame.lastProgressWrite >= this.timing.progressEveryMs) {
        frame.lastProgressWrite = now;
        this.deps.stores.stages.markProgress(stageRunId, frame.owner, now);
      }
      // An amendment has no attempt to roll its usage into.
      if (event.kind === 'harness.usage' && !frame.amend) {
        this.deps.post(runId, { type: 'usage_tick', stageRunId, attemptNo, usage: asUsage((event.data ?? {}) as Record<string, unknown>) });
      }
      const data = { ...((event.data as Record<string, unknown> | undefined) ?? {}), stageRunId, workflowRunId: runId, attemptNo };
      await this.deps.eventBus.emit(ctx.session!.id, { kind: event.kind, data } as AgentEvent).catch(() => undefined);
    });
  }

  // ── Timers: lease, deadline, idle watchdog ───────────────────

  private armFrameTimers(frame: Frame): void {
    const { stores } = this.deps;
    frame.timers.push(
      setInterval(() => {
        stores.stages.renewLease(frame.req.stageRunId, frame.owner, this.timing.leaseTtlMs, this.now());
      }, this.timing.renewEveryMs),
    );
  }

  private armWatchdog(ctx: AttemptContext): void {
    const { frame, stage } = ctx;
    const idleMs = stage.timeouts?.idleMs ?? STAGE_DEFAULTS.timeouts.idleMs;
    const attemptMs = stage.timeouts?.attemptMs ?? this.timing.defaultAttemptMs;
    const tick = Math.max(20, Math.min(this.timing.watchdogTickMs, Math.floor(Math.min(idleMs, attemptMs) / 4)));
    frame.timers.push(
      setInterval(() => {
        if (frame.stop || frame.parkedSince !== undefined) return;
        const now = this.now();
        const agentMs = now - frame.startedAt - frame.parkedMs;
        if (agentMs > attemptMs) {
          this.stopFrame(frame, { kind: 'failed', error: classified('attempt_timeout', `The attempt ran longer than ${attemptMs} ms of agent time`) });
          return;
        }
        if (frame.turnInFlight && now - frame.lastProgressAt > idleMs) {
          this.stopFrame(frame, { kind: 'failed', error: classified('idle_timeout', `No harness activity for ${idleMs} ms`) });
        }
      }, tick),
    );
  }

  // ── Turns ────────────────────────────────────────────────────

  /**
   * One journalled turn (the only place a stage talks to the model). A
   * settled turn replays without a model call; an interrupted one is
   * re-sent after a resume notice; a live one is settled together with its
   * assistant message, then the status is re-checked.
   */
  private async turn(
    ctx: AttemptContext,
    t: {
      opId: string;
      role: TurnRole;
      text: string;
      prepare?: boolean;
      outputSchema?: Record<string, unknown> | undefined;
      expect?: 'running' | 'validating';
      /** An operator turn's files and agent mode (the stage conversation API). */
      attachments?: AttachmentRef[];
      agentMode?: AgentMode | undefined;
    },
  ): Promise<SettledTurn> {
    const { stores, harness } = this.deps;
    const { frame, session, composed, owner } = ctx;
    const { stageRunId, attemptNo, runId } = frame.req;
    if (frame.stop) throw new AttemptStop(frame.stop);

    const prior = stores.turns.get(stageRunId, t.opId);
    if (prior?.state === 'settled') {
      ctx.recorder.restore({ content: prior.turn.content });
      return prior.turn;
    }
    let text = t.text;
    if (prior?.state === 'intent') {
      stores.turns.discard(stageRunId, t.opId);
      text = RESUME_NOTICE + text;
    }
    if (ctx.recap) {
      text = ctx.recap + text;
      ctx.recap = undefined;
    }
    if (ctx.rebind) {
      // A forced stop destroyed the provider conversation: bind it again (same session, resumed).
      await harness.resumeConversation(frame.conversationId!, composed!.params);
      ctx.rebind = false;
    }

    const agentMode = t.agentMode ?? ctx.agentMode;
    const attachments = t.attachments ?? [];
    const turnMeta = { stageRunId, workflowRunId: runId, attemptNo, opId: t.opId, turnRole: t.role };
    stores.turns.intent(stageRunId, t.opId, {
      role: t.role,
      policy: ctx.replayPolicy,
      now: this.now(),
      message: {
        id: generateId(),
        sessionId: session!.id,
        role: 'user',
        content: text,
        turnRole: t.role,
        metadata: turnMeta,
        complete: true,
        ...(attachments.length > 0
          ? {
              attachments: attachments.map((a) => ({
                name: a.displayName ?? path.basename(a.path),
                path: a.path,
                mimeType: a.mimeType ?? 'application/octet-stream',
                ...(a.artifactId ? { artifactId: a.artifactId } : {}),
              })),
            }
          : {}),
      },
    });
    if (t.role === 'operator') {
      await this.emitSession(ctx, 'stage_run.operator_message', {
        content: t.text,
        ...(attachments.length > 0 ? { attachments: attachments.map((a) => a.displayName ?? path.basename(a.path)) } : {}),
      });
    }

    const baseOptions = await composed!.turnOptions(agentMode);
    const options: SendPromptOptions = { ...baseOptions, ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}) };
    const turnId = this.deps.composer.beginTurn(owner!, frame.conversationId!, options, { policy: composed!.turnPolicy });
    ctx.recorder.begin({ turnId, agentMode: options.agentMode ?? agentMode });
    ctx.submittedThisTurn = [];
    const prompt = t.prepare ? composed!.preparePrompt(text, agentMode) : text;

    // The turn's own abort: a stop ends this turn; an attempt abort ends it too.
    const turnAc = new AbortController();
    const onAttemptAbort = (): void => turnAc.abort();
    frame.ac.signal.addEventListener('abort', onAttemptAbort, { once: true });
    frame.turnAc = turnAc;
    frame.turnInFlight = true;
    frame.lastProgressAt = this.now();
    let response: { content: string; structuredOutput?: unknown } | undefined;
    let failure: unknown;
    try {
      response = await harness.sendPromptAndWait(frame.conversationId!, prompt, attachments.length > 0 ? attachments : undefined, turnAc.signal, options);
    } catch (err) {
      failure = err ?? new Error('The turn failed');
    } finally {
      frame.turnInFlight = false;
      frame.turnAc = undefined;
      frame.ac.signal.removeEventListener('abort', onAttemptAbort);
    }
    // An aborted turn that RESOLVES (claude-agent) is handled like one that threw.
    if (frame.stop) {
      this.persistPartial(ctx, t.role, turnMeta);
      throw new AttemptStop(frame.stop);
    }
    const stopped = frame.turnStop;
    frame.turnStop = undefined;
    if (stopped) {
      // The operator stopped this turn (chat parity): it settles with what it
      // produced, and the stage continues from the next turn boundary.
      const partial = ctx.recorder.take({ partial: true });
      const settled: SettledTurn = { role: t.role, content: partial?.content ?? response?.content ?? '' };
      stores.turns.settle(stageRunId, t.opId, settled, {
        now: this.now(),
        ...(partial
          ? {
              message: {
                id: generateId(),
                sessionId: session!.id,
                role: 'assistant' as const,
                content: partial.content,
                turnRole: t.role,
                metadata: { ...partial.metadata, ...turnMeta, stopped: true },
                complete: true,
              },
            }
          : {}),
      });
      if (stopped.force) ctx.rebind = true;
      await this.emitSession(ctx, 'stage_run.turn_cancelled', { opId: t.opId, force: stopped.force });
      this.recheck(ctx, t.expect ?? 'running');
      return settled;
    }
    if (failure !== undefined || !response) {
      this.persistPartial(ctx, t.role, turnMeta);
      throw this.harnessFailure(ctx, failure);
    }

    const recorded = ctx.recorder.take({ fallbackContent: response.content });
    const content = recorded?.content ?? response.content ?? '';
    const settled: SettledTurn = {
      role: t.role,
      content,
      ...(response.structuredOutput !== undefined ? { structuredOutput: response.structuredOutput } : {}),
      ...(ctx.submittedThisTurn.length > 0 ? { submitted: ctx.submittedThisTurn[ctx.submittedThisTurn.length - 1] } : {}),
    };
    stores.turns.settle(stageRunId, t.opId, settled, {
      now: this.now(),
      ...(recorded
        ? {
            message: {
              id: generateId(),
              sessionId: session!.id,
              role: 'assistant' as const,
              content: recorded.content,
              turnRole: t.role,
              metadata: { ...recorded.metadata, ...turnMeta },
              complete: true,
            },
          }
        : {}),
    });
    const remembered = await rememberProviderSession(harness, this.deps.sessionRepo, session!);
    if (remembered) session!.providerSessionId = remembered;
    if (settled.submitted !== undefined && !frame.amend) stores.attempts.update(stageRunId, attemptNo, { structuredOutput: settled.submitted });
    this.recheck(ctx, t.expect ?? 'running');
    return settled;
  }

  /** Files uploaded to this stage (artifact ids), as the harness attaches them; a foreign id is dropped. */
  private async attachmentsOf(ctx: AttemptContext, ids: readonly string[] | undefined): Promise<AttachmentRef[]> {
    if (!ids?.length || !this.deps.artifacts) return [];
    const out: AttachmentRef[] = [];
    for (const id of ids) {
      const a = await this.deps.artifacts.getArtifact(id).catch(() => null);
      if (!a || a.stageRunId !== ctx.frame.req.stageRunId) continue;
      out.push({ type: 'file', path: a.path, displayName: a.name, artifactId: a.id, ...(a.mimeType ? { mimeType: a.mimeType } : {}) });
    }
    return out;
  }

  /**
   * Send the queued operator messages, one turn each (the stage conversation
   * API). The instance is `running`; each answer becomes the output text.
   */
  private async operatorTurns(ctx: AttemptContext, opPrefix: string): Promise<void> {
    const queue = ctx.frame.operatorQueue;
    while (queue.length > 0) {
      const op = queue.shift()!;
      const turn = await this.turn(ctx, {
        opId: `${opPrefix}/operator/${generateId()}`,
        role: 'operator',
        text: op.prompt,
        prepare: true,
        attachments: await this.attachmentsOf(ctx, op.attachmentIds),
        agentMode: op.agentMode,
      });
      this.recordOutput(ctx, turn);
    }
  }

  private persistPartial(ctx: AttemptContext, role: TurnRole, meta: Record<string, unknown>): void {
    const partial = ctx.recorder.take({ partial: true });
    if (!partial || !ctx.session) return;
    this.deps.stores.turns.recordPartial(
      { id: generateId(), sessionId: ctx.session.id, role: 'assistant', content: partial.content, turnRole: role, metadata: { ...partial.metadata, ...meta }, complete: false },
      this.now(),
    );
  }

  private harnessFailure(ctx: AttemptContext, err: unknown): AttemptStop {
    const raw = this.deps.toHarnessError ? this.deps.toHarnessError(ctx.composed?.provider, err) : err;
    return new AttemptStop({ kind: 'failed', error: classifyStageError(raw) });
  }

  /** After a turn: if the stage or the run moved on, stop and write nothing (F-1, O-9). */
  private recheck(ctx: AttemptContext, expect: 'running' | 'validating'): void {
    const { frame } = ctx;
    if (frame.stop) throw new AttemptStop(frame.stop);
    if (this.dead) throw new AttemptStop({ kind: 'aborted', reason: 'superseded' });
    const row = this.deps.stores.stages.getInstance(frame.req.stageRunId);
    // An amendment holds no lease: it only needs the instance still completed.
    if (frame.amend) {
      if (!row || row.status !== 'completed') throw new AttemptStop({ kind: 'aborted', reason: 'superseded' });
      return;
    }
    if (!row || row.status !== expect || row.leaseOwner !== frame.owner || row.currentAttempt !== frame.req.attemptNo) {
      throw new AttemptStop({ kind: 'aborted', reason: 'superseded' });
    }
  }

  private recordOutput(ctx: AttemptContext, turn: SettledTurn): void {
    if (turn.structuredOutput !== undefined) ctx.outputs.native.push(turn.structuredOutput);
    if (turn.submitted !== undefined) ctx.outputs.submitted.push(turn.submitted);
    ctx.outputs.texts.push(turn.content);
    if (turn.content.trim().length > 0 || ctx.outputText.length === 0) ctx.outputText = turn.content;
  }

  private render(ctx: AttemptContext, text: string): { rendered: string; unresolved: string[] } {
    const scope = { ...expressionScope({ ...ctx.state.run, variables: userVariables(ctx.variables) }, ctx.state.instances) };
    const vars = scope['variables'] as Record<string, unknown>;
    const unresolved = templateVariableNames(text).filter((n) => vars[n] === undefined || vars[n] === null);
    const r = renderTemplate(text, scope);
    return { rendered: r.ok ? r.text : text, unresolved };
  }

  /** Predecessor results, as the stage's `context` asks (G5 §2.6), fenced as untrusted (F O-3). */
  private contextBlocks(ctx: AttemptContext): string[] {
    const mode = ctx.stage.context.mode;
    if (mode === 'none') return [];
    const from = ctx.stage.context.from ?? ctx.graph.edges.filter((e) => e.to === ctx.stage.key).map((e) => e.from);
    const blocks: string[] = [];
    for (const key of [...new Set(from)]) {
      const inst = ctx.state.instances.find((i) => i.scopeId === null && i.stageKey === key);
      if (!inst || inst.status !== 'completed') continue;
      const name = ctx.graph.stages.find((s) => s.key === key)?.name ?? key;
      const text = typeof inst.output === 'string' ? inst.output : inst.output !== null && inst.output !== undefined ? JSON.stringify(inst.output, null, 2) : '';
      let body: string;
      if (mode === 'output') body = text || inst.summary || '';
      else if (mode === 'structured') body = `${inst.summary ?? ''}${inst.output !== null && typeof inst.output === 'object' ? `\n\n\`\`\`json\n${JSON.stringify(inst.output, null, 2)}\n\`\`\`` : ''}`;
      else body = inst.summary ?? (text.length > 3000 ? `${text.slice(0, 3000)}\n… (truncated)` : text);
      blocks.push(`## Completed stage "${name}"\n${body}`);
    }
    return blocks;
  }

  /** How the final prompt asks for the structured output, per strategy. */
  private outputInstructions(ctx: AttemptContext): string {
    const parts: string[] = [];
    if (ctx.stage.output.instructions) parts.push(`**Expected output:**\n${this.render(ctx, ctx.stage.output.instructions).rendered}`);
    if (ctx.contract.format === 'json') {
      const schema = ctx.contract.schema ? `\n\`\`\`json\n${JSON.stringify(ctx.contract.schema, null, 2)}\n\`\`\`` : '';
      const first = ctx.strategies[0];
      if (first === 'tool') parts.push(`When you are done, call \`submit_output\` with the structured output matching this schema:${schema}`);
      else if (first === 'final_json_block') parts.push(`End your answer with the structured output as one \`\`\`json block matching this schema:${schema}`);
    }
    return parts.length > 0 ? `\n\n---\n${parts.join('\n\n')}\n` : '';
  }

  private async promptTurns(ctx: AttemptContext): Promise<void> {
    this.armWatchdog(ctx);
    const { stage } = ctx;
    const context = [...this.contextBlocks(ctx), ...ctx.hookContext];
    const last = stage.prompts.length - 1;
    for (let i = 0; i <= last; i++) {
      const prompt = stage.prompts[i]!;
      const r = this.render(ctx, prompt.text);
      if (r.unresolved.length > 0) {
        await this.emitSession(ctx, 'harness.session_info', {
          infoType: 'unresolved_variables',
          message: `Warning: unresolved variables — ${r.unresolved.join(', ')}. Placeholder(s) sent to the model as-is.`,
          unresolved: r.unresolved,
        });
      }
      let text = r.rendered;
      if (i === 0 && context.length > 0) text = fenceContext(context) + text;
      if (i === last) text += this.outputInstructions(ctx);
      const turn = await this.turn(ctx, {
        opId: `a${ctx.epoch}/prompt/${i}`,
        role: 'prompt',
        text,
        prepare: true,
        ...(i === last && ctx.strategies[0] === 'native' ? { outputSchema: ctx.contract.schema ?? { type: 'object' } } : {}),
      });
      this.recordOutput(ctx, turn);
      // A message the operator sent meanwhile is the next turn (PD-3: never mid-turn).
      await this.operatorTurns(ctx, `a${ctx.epoch}`);
    }
  }

  // ── Output contract, repairs, approval ───────────────────────

  private toValidating(ctx: AttemptContext): void {
    const r = this.deps.stores.stages.transition(ctx.frame.req.stageRunId, ['running'], 'validating', { runId: ctx.frame.req.runId, now: this.now() });
    if (!r.ok) throw new AttemptStop(ctx.frame.stop ?? { kind: 'aborted', reason: 'superseded' });
  }

  private backToRunning(ctx: AttemptContext, from: 'validating' | 'awaiting_input'): void {
    const r = this.deps.stores.stages.transition(ctx.frame.req.stageRunId, [from], 'running', {
      lease: { owner: ctx.frame.owner, ttlMs: this.timing.leaseTtlMs },
      runId: ctx.frame.req.runId,
      now: this.now(),
    });
    if (!r.ok) throw new AttemptStop(ctx.frame.stop ?? { kind: 'aborted', reason: 'superseded' });
  }

  /**
   * running → validating, the contract, and repair turns while the repair
   * budget lasts (G5 §3.4). Ends in `validating` with the checked output.
   */
  private async validate(ctx: AttemptContext): Promise<{ data?: unknown }> {
    const { stores } = this.deps;
    const { stageRunId, attemptNo } = ctx.frame.req;
    const maxRepairs = ctx.stage.repair?.maxRepairs ?? 2;
    this.toValidating(ctx);
    for (;;) {
      const check = await checkOutputContract(ctx.contract, ctx.strategies, ctx.outputs, ctx.outputText, {
        logger: this.logger,
        scriptRunner: this.deps.scriptRunner,
        workspacePath: ctx.workDir,
        stageRunId,
        scope: expressionScope({ ...ctx.state.run, variables: userVariables(ctx.variables) }, ctx.state.instances),
      });
      this.recheck(ctx, 'validating');
      if (check.ok) {
        if (check.data !== undefined) stores.attempts.update(stageRunId, attemptNo, { structuredOutput: check.data });
        return check.data !== undefined ? { data: check.data } : {};
      }
      const used = stores.attempts.get(stageRunId, attemptNo)?.repairCount ?? 0;
      if (used >= maxRepairs) throw new AttemptStop({ kind: 'failed', error: check.error });
      // validating → running with repair_count + 1, then the repair turn.
      this.backToRunning(ctx, 'validating');
      const n = stores.attempts.incrementRepair(stageRunId, attemptNo);
      if (n === null) throw new AttemptStop(ctx.frame.stop ?? { kind: 'aborted', reason: 'superseded' });
      await this.emitSession(ctx, 'stage_run.repairing', { repair: n, failures: check.failures });
      const turn = await this.turn(ctx, {
        opId: `a${ctx.epoch}/repair/${n - 1}`,
        role: 'repair',
        text: repairMessage(check.failures, ctx.strategies, ctx.contract.format),
        prepare: true,
      });
      this.recordOutput(ctx, turn);
      this.toValidating(ctx);
    }
  }

  /** Whether a successor reads this stage's summary (only then a text stage pays a summary turn). */
  private successorWantsSummary(ctx: AttemptContext): boolean {
    const key = ctx.stage.key;
    return ctx.graph.stages.some(
      (s) =>
        s.key !== key &&
        s.context.mode === 'summary' &&
        (s.context.from ? s.context.from.includes(key) : ctx.graph.edges.some((e) => e.from === key && e.to === s.key)),
    );
  }

  private async summary(ctx: AttemptContext, data: unknown): Promise<string | undefined> {
    const name = ctx.stage.name;
    if (ctx.contract.format === 'json') {
      const keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
      return keys.length > 0 ? `Stage "${name}" completed. Produced structured output with keys: ${keys.join(', ')}.` : `Stage "${name}" completed.`;
    }
    if (!this.successorWantsSummary(ctx)) return undefined;
    const turn = await this.turn(ctx, {
      opId: `a${ctx.epoch}/summary`,
      role: 'summary',
      text:
        `Provide a concise summary (max 500 words) of the work you just completed in this stage named "${name}". ` +
        'Include key actions, files created or modified, decisions and outputs. It is handed to later workflow stages as context.',
      expect: 'validating',
    });
    return turn.content.trim().length > 0 ? turn.content : undefined;
  }

  /**
   * Validation, the summary, then the approval gate: running →
   * awaiting_input(completion_review) with the lease cleared; changes run a
   * revision turn through the same journalled path (F-2, W-46), which is
   * validated again before the next round.
   */
  private async validateAndReview(ctx: AttemptContext): Promise<StageOutput> {
    for (;;) {
      const out = await this.validateAndReviewOnce(ctx);
      // No await between this check and `closed`: a message that arrives
      // later is refused (the stage is finishing) instead of being lost.
      if (ctx.frame.operatorQueue.length === 0) {
        ctx.frame.closed = true;
        return out;
      }
      // Messages sent while the output was checked or summarised: send them,
      // then the output is checked (and reviewed) again.
      this.backToRunning(ctx, 'validating');
      await this.operatorTurns(ctx, `a${ctx.epoch}`);
    }
  }

  private async validateAndReviewOnce(ctx: AttemptContext): Promise<StageOutput> {
    let checked = await this.validate(ctx);
    let summary = await this.summary(ctx, checked.data);
    const approval = ctx.stage.approval;
    if (approval) {
      const maxRounds = approval.maxRounds;
      for (let round = 1; ; round++) {
        this.backToRunning(ctx, 'validating');
        const verdict = await this.awaitVerdict(ctx, {
          kind: 'stage_completion_review',
          stageName: ctx.stage.name,
          reason:
            round === 1
              ? approval.prompt
                ? this.render(ctx, approval.prompt).rendered
                : `Stage "${ctx.stage.name}" completed. Approve to advance, or request changes.`
              : `Stage "${ctx.stage.name}" updated after feedback (round ${round}). Approve or request more changes.`,
          summary: summary ?? null,
          output: ctx.outputText.length > 4000 ? `${ctx.outputText.slice(0, 4000)}…` : ctx.outputText,
          reviewRound: round,
          canRequestChanges: approval.allowChanges && round <= maxRounds,
        });
        if (verdict.outcome === 'approved') {
          this.toValidating(ctx);
          break;
        }
        const feedback = (verdict.feedback ?? '').trim();
        if (verdict.outcome !== 'changes_requested' || !feedback || !approval.allowChanges || round > maxRounds) {
          // Nothing to revise (or the rounds are spent): ask again.
          this.toValidating(ctx);
          continue;
        }
        const turn = await this.turn(ctx, {
          opId: `a${ctx.epoch}/review/${round}/${digest(feedback)}`,
          role: 'approval_feedback',
          text: feedback,
          prepare: true,
        });
        this.recordOutput(ctx, turn);
        checked = await this.validate(ctx);
        summary = await this.summary(ctx, checked.data);
      }
    }
    return {
      ...(checked.data !== undefined ? { data: checked.data } : {}),
      text: ctx.outputText,
      ...(summary !== undefined ? { summary } : {}),
    };
  }

  /**
   * Park the frame on a human (the approval gate): running → awaiting_input
   * (lease cleared, B-2), the admission slot handed back, the deadline
   * paused (B-7); the actor's `deliver_input` resumes it. A verdict carried
   * by a resume attempt answers the first gate without parking.
   */
  private async awaitVerdict(ctx: AttemptContext, interruptData: Record<string, unknown>): Promise<ApprovalVerdict> {
    const { frame } = ctx;
    if (frame.carriedVerdict) {
      const v = frame.carriedVerdict;
      frame.carriedVerdict = undefined;
      return v;
    }
    const verdict = await this.parkFrame(ctx, interruptData);
    this.backToRunning(ctx, 'awaiting_input');
    return verdict;
  }

  private async parkFrame(ctx: AttemptContext, interruptData: Record<string, unknown>): Promise<ApprovalVerdict> {
    const { frame } = ctx;
    const { stageRunId, runId } = frame.req;
    const r = this.deps.stores.stages.transition(stageRunId, ['running'], 'awaiting_input', {
      patch: { interruptData },
      runId,
      now: this.now(),
    });
    if (!r.ok) throw new AttemptStop(frame.stop ?? { kind: 'aborted', reason: 'superseded' });
    await this.emitSession(ctx, 'stage_run.awaiting_input', { interruptData, version: r.row.version });
    frame.parkedSince = this.now();
    frame.ticket?.pause();
    let verdict: ApprovalVerdict | null;
    try {
      verdict = await new Promise<ApprovalVerdict | null>((resolve) => {
        if (frame.stop) return resolve(null);
        frame.waiter = { resolve };
      });
    } finally {
      frame.parkedMs += this.now() - (frame.parkedSince ?? this.now());
      frame.parkedSince = undefined;
      frame.lastProgressAt = this.now();
    }
    if (!verdict && frame.turnStop && !frame.stop) {
      // The operator stopped the turn this gate belongs to: the gate ends, the turn returns.
      await frame.ticket?.resume();
      this.backToRunning(ctx, 'awaiting_input');
      throw new TurnStoppedAtGate();
    }
    if (!verdict) throw new AttemptStop(frame.stop ?? { kind: 'aborted', reason: 'superseded' });
    await frame.ticket?.resume();
    await this.emitSession(ctx, 'stage_run.input_received', { outcome: verdict.outcome });
    return verdict;
  }

  /** A tool permission, question or plan gate inside a turn (the StageGatePort `park`). */
  private async park(ctx: AttemptContext, _turn: TurnContext, data: Record<string, unknown>, prompt: string): Promise<InterruptResolution> {
    try {
      const verdict = await this.parkFrame(ctx, { ...data, prompt });
      this.backToRunning(ctx, 'awaiting_input');
      return {
        outcome: verdict.outcome,
        ...(verdict.data !== undefined ? { value: verdict.data } : verdict.feedback !== undefined ? { value: { feedback: verdict.feedback } } : {}),
        ...(verdict.feedback !== undefined ? { reason: verdict.feedback } : {}),
      };
    } catch (err) {
      if (err instanceof TurnStoppedAtGate) return { outcome: 'rejected', reason: 'The turn was stopped by the operator (cancelled)' };
      // The attempt is stopping: the turn's own abort ends it.
      return { outcome: 'rejected', reason: 'The stage was stopped (cancelled)' };
    }
  }

  // ── Amendment of a completed stage (PD-4) ────────────────────

  /**
   * The amendment's turns: the operator message (json stages get the output
   * instructions again), then the output contract with repair turns. No
   * status change, no lease; the instance must stay `completed` throughout.
   */
  private async amendBody(ctx: AttemptContext): Promise<void> {
    const { stores } = this.deps;
    const { stageRunId } = ctx.frame.req;
    this.armWatchdog(ctx);
    await this.bindSession(ctx);
    ctx.outputText = typeof ctx.instance.output === 'string' ? ctx.instance.output : '';
    const prefix = `amend/${generateId()}`;
    const queue = ctx.frame.operatorQueue;
    while (queue.length > 0) {
      const op = queue.shift()!;
      const json = ctx.contract.format === 'json';
      const turn = await this.turn(ctx, {
        opId: `${prefix}/operator/${generateId()}`,
        role: 'operator',
        text: json ? op.prompt + this.outputInstructions(ctx) : op.prompt,
        prepare: true,
        attachments: await this.attachmentsOf(ctx, op.attachmentIds),
        agentMode: op.agentMode,
        ...(json && ctx.strategies[0] === 'native' ? { outputSchema: ctx.contract.schema ?? { type: 'object' } } : {}),
      });
      this.recordOutput(ctx, turn);
    }
    const maxRepairs = ctx.stage.repair?.maxRepairs ?? 2;
    for (let repairs = 0; ; repairs++) {
      const check = await checkOutputContract(ctx.contract, ctx.strategies, ctx.outputs, ctx.outputText, {
        logger: this.logger,
        scriptRunner: this.deps.scriptRunner,
        workspacePath: ctx.workDir,
        stageRunId,
        scope: expressionScope({ ...ctx.state.run, variables: userVariables(ctx.variables) }, ctx.state.instances),
      });
      this.recheck(ctx, 'running');
      if (check.ok) {
        const summary =
          ctx.contract.format === 'json'
            ? await this.summary(ctx, check.data)
            : undefined;
        const at = this.now();
        if (!stores.stages.amend(stageRunId, { outputText: ctx.outputText, ...(check.data !== undefined ? { outputData: check.data } : {}), ...(summary !== undefined ? { summary } : {}) }, at)) {
          throw new AttemptStop({ kind: 'aborted', reason: 'superseded' });
        }
        await this.emitSession(ctx, 'stage_run.amended', {
          amendedAt: at,
          outputText: ctx.outputText.length > 4000 ? `${ctx.outputText.slice(0, 4000)}…` : ctx.outputText,
        });
        return;
      }
      if (repairs >= maxRepairs) throw new AttemptStop({ kind: 'failed', error: check.error });
      await this.emitSession(ctx, 'stage_run.repairing', { repair: repairs + 1, failures: check.failures, amend: true });
      const turn = await this.turn(ctx, {
        opId: `${prefix}/repair/${repairs}`,
        role: 'repair',
        text: repairMessage(check.failures, ctx.strategies, ctx.contract.format),
        prepare: true,
      });
      this.recordOutput(ctx, turn);
    }
  }

  /** A terminal run keeps no live conversation (B-15): release the one an amendment re-opened. */
  private async releaseAfterAmend(ctx: AttemptContext): Promise<void> {
    const { stores, harness, sessionRepo } = this.deps;
    const { runId, stageRunId } = ctx.frame.req;
    const run = stores.runs.getRunRow(runId);
    if (!run || !['completed', 'failed', 'cancelled'].includes(run.status) || !ctx.session || !ctx.frame.sessionKey) return;
    if (ctx.session.conversationId) await harness.destroyConversation(ctx.session.conversationId).catch(() => undefined);
    await sessionRepo.updateStatus(ctx.session.id, 'closed');
    await sessionRepo.update(ctx.session.id, { closedAt: new Date(this.now()) });
    stores.runSessions.release(runId, ctx.frame.sessionKey, this.now());
    stores.turns.release(stageRunId);
  }

  // ── Hooks and checkpoints ────────────────────────────────────

  private hookContext(ctx: AttemptContext): HookContext {
    return {
      sessionId: ctx.session?.id ?? '__pre_session__',
      workflowId: ctx.frame.req.runId,
      workspacePath: ctx.workDir,
      variables: Object.fromEntries(Object.entries(ctx.variables).map(([k, v]) => [k, String(v)])),
      eventBus: this.deps.eventBus,
      workflowRunId: ctx.frame.req.runId,
      stageRunId: ctx.frame.req.stageRunId,
      abortSignal: ctx.frame.ac.signal,
      templateScope: expressionScope({ ...ctx.state.run, variables: userVariables(ctx.variables) }, ctx.state.instances),
    };
  }

  /** `pre_run` hooks: an abort fails the attempt (classified, B `(c)`); variables go to the attempt's copy (W-41). */
  private async preRunHooks(ctx: AttemptContext): Promise<void> {
    const hooks = ctx.stage.hooks;
    if (!this.deps.hookExecutor || hooks.length === 0) return;
    const r = await this.deps.hookExecutor.executePhase('pre_run', hooks, this.hookContext(ctx));
    if (!r.shouldContinue) {
      throw new StageError('pre_run_hook_abort', r.mergedResult.abortReason ?? `pre_run hook aborted stage "${ctx.stage.name}"`);
    }
    for (const [k, v] of Object.entries(r.mergedResult.variables ?? {})) ctx.variables[k] = v;
    for (const m of r.mergedResult.contextMessages ?? []) ctx.hookContext.push(m.content);
    for (const att of r.mergedResult.attachments ?? []) {
      const dir = path.join(ctx.workDir, 'hook-attachments');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, path.basename(att.filename)), att.content, 'utf-8');
    }
  }

  private async postRunHooks(ctx: AttemptContext): Promise<void> {
    const hooks = ctx.stage.hooks;
    if (!this.deps.hookExecutor || hooks.length === 0) return;
    await this.deps.hookExecutor.executePhase('post_run', hooks, this.hookContext(ctx)).catch(() => undefined);
  }

  /** The "before" checkpoint of the epoch, in `starting`; skipped for stages that cannot write (F O-1). */
  private async captureCheckpoint(ctx: AttemptContext): Promise<void> {
    const svc = this.deps.checkpoints;
    if (!svc || ctx.mode === 'resume') return;
    const groups = ctx.composed?.projection.toolPolicy.groups as Record<string, boolean> | undefined;
    const writes = !groups || Object.entries(groups).some(([g, on]) => on && g !== 'fileRead' && g !== 'web');
    if (!writes) return;
    const { runId, stageRunId, attemptNo } = ctx.frame.req;
    await svc
      .capture({
        workspaceId: ctx.workspace.id,
        kind: 'stage',
        label: ctx.stage.name,
        workflowRunId: runId,
        stageRunId,
        phase: 'before',
        turnId: `attempt:${stageRunId}:${ctx.epoch}`,
        ...(ctx.session ? { sessionId: ctx.session.id } : {}),
      })
      .then((records) => {
        const first = records[0];
        if (first) this.deps.stores.attempts.update(stageRunId, attemptNo, { checkpointBeforeId: first.id });
      })
      .catch(() => undefined);
  }

  private async emitSession(ctx: AttemptContext, kind: string, data: Record<string, unknown>): Promise<void> {
    const full = { stageRunId: ctx.frame.req.stageRunId, workflowRunId: ctx.frame.req.runId, ...data };
    const event = { kind, data: full } as unknown as AgentEvent;
    await (ctx.session ? this.deps.eventBus.emit(ctx.session.id, event) : this.deps.eventBus.emitGlobal(event)).catch(() => undefined);
  }
}

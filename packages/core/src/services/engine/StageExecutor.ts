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
import { DEFAULT_AGENT_MODE, generateId, runInContext } from '@generatorai/shared';
import {
  expansionNodeKey,
  expansionPlanJsonSchema,
  isTerminalStageRunState,
  renderTemplate,
  resolveSessionSpec,
  STAGE_DEFAULTS,
  templateVariableNames,
  type AgentMode,
  type AgentStage,
  type PromptDefinition,
  type SessionSpec,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import { classifyStageError, classified, StageError, type ClassifiedError } from '../../domain/errors/StageError.js';
import type { EngineStores, SettledTurn, TurnJournalEntry, TurnReplayPolicy, TurnRole } from '../../domain/ports/IEngineStore.js';
import type { AttachmentRef, IAgentHarness, SendPromptOptions } from '../../domain/ports/IAgentHarness.js';
import type { ISessionRepository } from '../../domain/ports/IRepositories.js';
import type { IScriptRunner } from '../../domain/ports/IScriptRunner.js';
import type { WorkflowSecretResolver } from '../../mcp/McpCredentialVault.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import type { HostToolsLevel, StructuredOutputLevel } from '../../domain/ports/IProviderInstance.js';
import type { ApprovalVerdict, AttemptMode, AttemptOutcome, InstanceState, OperatorTurn, RunMessage, RunState, StageOutput, Usage } from '../../domain/scheduler/types.js';
import type { EventBus } from '../../events/EventBus.js';
import { providerFlowKey, type AdmissionTicket } from '../AdmissionController.js';
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
import { mapItemPlacement, runForItem } from './MapEffects.js';
import type { WorkflowCallbacks } from './WorkflowCallbacks.js';
import { waitInterruptOf } from '../../domain/scheduler/waits.js';
import { StageConversationError } from './StageConversationError.js';
import { runCheck } from './CheckRunner.js';
import type { AttemptTrace, EngineTelemetry } from './EngineTelemetry.js';
import { AUTO_SUMMARY_TURN_THRESHOLD, autoSummary, jsonSummary, summaryPrompt } from './summaries.js';
import { compile, type CompiledNode, type CompiledWorkflow } from '../../domain/workflow-graph/compile.js';
import { isWrapUp, scopeIndexOf, templateScope } from '../../domain/scheduler/scope.js';
import { graphForInstance, validateExpansion } from '../../domain/scheduler/expansion.js';
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
  /** Resolves `secretref:workflow/<name>` values of check `env` and `custom_script` rule `env` (PLATFORM-R2); without it such a value fails the check. */
  workflowSecrets?: WorkflowSecretResolver | undefined;
  /**
   * The harness boundary (P03 WP-3.4): a provider failure becomes a
   * `HarnessError` (`toHarnessError` of `@generatorai/agent-harness-providers`).
   */
  toHarnessError?: ((provider: string | undefined, raw: unknown) => unknown) | undefined;
  /** Files uploaded to a stage (the stage conversation API's attachments). */
  artifacts?: StageArtifactReader | undefined;
  /** Deliver a message to the run's actor. */
  post: (runId: string, msg: RunMessage) => void;
  /** Per-wait callback tokens: `stages.<wait>.callbackUrl` / `callbackToken` of a waiting event wait (P05 §4.3). */
  callbacks?: WorkflowCallbacks | undefined;
  /** The `invoke_agent` span of each attempt (P07 WP-7.4). */
  telemetry?: EngineTelemetry | undefined;
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

/**
 * Whether a turn on `provider` runs inside the attempt's admission: only
 * when the attempt was admitted holding that provider's flow key (a launch
 * whose provider could not be resolved, or a judge on another provider,
 * takes the provider's own per-turn permit).
 */
function admittedOn(frame: Pick<Frame, 'ticket'>, provider: string | undefined): boolean {
  return !!provider && !!frame.ticket?.holds(providerFlowKey(provider));
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
  /** Drops the composed session's registrations (a stage orchestrator parent, the turn context) when the attempt ends (PLATFORM-R17). */
  disposeSession?: () => void;
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
  /** Set while the frame waits for an operator message (its last answer was stopped). */
  operatorWaiter?: () => void;
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
  /** The pinned version, compiled (loop settings and bodies). */
  compiled: CompiledWorkflow;
  /** The nearest enclosing loop instance (P05), and the iteration this instance belongs to. */
  loop?: { inst: InstanceState; node: CompiledNode; k: number };
  /** This instance is its loop's wrap-up (`<loop>#wrapup/<stage>`). */
  wrapUp: boolean;
  /** The prompt turns of this attempt: `prompts`, `followUpPrompts` from iteration 1, or the wrap-up prompt. */
  prompts: PromptDefinition[];
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
  /** The attempt's `invoke_agent` span (P07 WP-7.4). */
  trace?: AttemptTrace;
  /**
   * The epoch's journal when the attempt began, in issue order, and the
   * last entry this attempt replayed: a resume replays the operator and
   * revision turns where they were taken (ENGINE-R1, R7).
   */
  journal: Array<{ opId: string; entry: TurnJournalEntry }>;
  cursor: number;
  /** The next operator turn's number in the epoch (`a<epoch>/operator/<n>`). */
  opSeq: number;
  /** The latest output-producing turn was stopped by the operator: its answer is not the stage's output yet (ENGINE-R16). */
  lastStopped: boolean;
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
  // Dollars only when the provider reports them (`costUsd`); no pricing table (P07 WP-7.3).
  const cost = n(data['costUsd']);
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

  /**
   * A verdict for a frame parked in `awaiting_input` (the `deliver_input`
   * effect). False only when this process has no frame for the attempt
   * (ENGINE-R2): the waiter is in place before the instance is written
   * `awaiting_input`, so a live frame without one has already left the gate
   * (an operator stop) — the verdict is dropped and the next gate asks again.
   */
  deliverInput(stageRunId: string, attemptNo: number, verdict: ApprovalVerdict): boolean {
    const f = this.frames.get(stageRunId);
    if (!f || f.req.attemptNo !== attemptNo) return false;
    const w = f.waiter;
    if (!w) {
      this.logger?.warn(`[StageExecutor] a verdict for ${stageRunId} arrived after its gate closed; dropped`);
      return true;
    }
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
    const wake = f.operatorWaiter;
    f.operatorWaiter = undefined;
    wake?.();
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
      // Inside a container that still runs (a loop iterating, a map), the
      // stage's conversation may be the live scope's (CONVINV-R4): refused.
      const byId = new Map(ctx.state.instances.map((i) => [i.id, i]));
      for (let c = ctx.instance.scopeId ? byId.get(ctx.instance.scopeId) : undefined; c; c = c.scopeId ? byId.get(c.scopeId) : undefined) {
        if (!isTerminalStageRunState(c.status)) {
          throw new StageConversationError('STAGE_BUSY', `The stage is inside "${c.stageKey}", which is still running; amend it once that finishes`);
        }
      }
      // Any live frame on the same conversation — bound, or launched with a session group not bound yet.
      const key = this.sessionKey(ctx);
      const group = ctx.stage.sessionGroup;
      for (const other of this.frames.values()) {
        if (other === frame || other.req.runId !== runId) continue;
        const otherGroup = ctx.compiled.nodes.get(byId.get(other.req.stageRunId)?.stageKey ?? '')?.sessionGroup;
        if (other.sessionKey === key || (other.sessionKey === undefined && !!group && otherGroup === group)) {
          throw new StageConversationError('STAGE_BUSY', group ? `The stage's session group "${group}" is in use by another stage` : 'The stage\'s conversation is in use by another stage');
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
    const wake = f.operatorWaiter;
    f.operatorWaiter = undefined;
    wake?.();
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
      // The session is released with the attempt: its registrations go too (a later attempt composes again).
      try {
        frame.disposeSession?.();
      } catch {
        /* best effort */
      }
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
    // A check stage runs one command, no conversation (P05 §1.2).
    if (stores.stages.getInstance(stageRunId)?.kind === 'check') return this.checkAttempt(frame);

    const carried = attempt.overrides as { verdict?: ApprovalVerdict; operatorTurn?: OperatorTurn } | null;
    if (carried?.verdict) frame.carriedVerdict = carried.verdict;
    // A message sent to the paused stage (the retry's `promptOverride`) is its next operator turn.
    if (carried?.operatorTurn) frame.operatorQueue.push(carried.operatorTurn);

    const ctx = await this.context(frame, attempt.mode, journalEpoch(attempts, attemptNo));
    const { stage } = ctx;
    // The attempt's `invoke_agent` span; its turns run in its context, so the
    // provider's `chat` / `execute_tool` spans nest under it (P07 WP-7.4).
    const spec = stageSessionSpec(ctx.graph, stage, ctx.run).merged;
    ctx.trace = this.deps.telemetry?.attempt({
      runId,
      stageRunId,
      instancePath: ctx.instance.instancePath,
      stageKey: stage.key,
      attemptNo,
      mode: attempt.mode,
      model: spec.model,
      harnessType: spec.harnessType,
    });
    if (!ctx.trace) return this.attemptBody(ctx);
    const trace = ctx.trace;
    try {
      const outcome = await runInContext(trace.ctx, () => this.attemptBody(ctx));
      trace.end({ kind: outcome.kind });
      return outcome;
    } catch (err) {
      trace.end(err instanceof AttemptStop ? { kind: err.outcome.kind, ...(err.outcome.kind === 'failed' ? { error: err.message } : {}) } : { kind: 'failed', error: err });
      throw err;
    }
  }

  /** The attempt after its context: checkpoint, hooks, session, turns, the output contract. */
  private async attemptBody(ctx: AttemptContext): Promise<AttemptOutcome> {
    const { stores } = this.deps;
    const { frame, stage, workspace } = ctx;
    const { runId, stageRunId, attemptNo } = frame.req;

    // A restart starts from the attempt-1 checkpoint (G5 §3.3).
    if (ctx.mode === 'restart' && (stage.retry?.restoreCheckpointOnRestart ?? true) && this.deps.checkpoints) {
      await this.deps.checkpoints
        .restoreTurn(workspace.id, `attempt:${stageRunId}:1`, { workflowRunId: runId }, 'before')
        .catch((err: unknown) => this.logger?.warn(`[StageExecutor] checkpoint restore failed: ${String(err)}`));
    }

    await this.preRunHooks(ctx);
    await this.bindSession(ctx);
    await this.seedDigest(ctx);
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

  /** One attempt of a check stage: starting → running → the command → validating (P05 §1.2). */
  private async checkAttempt(frame: Frame): Promise<AttemptOutcome> {
    const { stores } = this.deps;
    const { runId, stageRunId } = frame.req;
    const run = await this.deps.runRepo.getById(runId);
    const graph = await this.deps.definitions.get(run.definitionVersionId);
    const state = stores.runStore.loadRunState(runId);
    const instance = state?.instances.find((i) => i.id === stageRunId);
    const stage = graph.stages.find((s) => s.key === instance?.stageKey);
    if (!state || !instance || stage?.kind !== 'check') throw new StageError('config_invalid', `Instance ${stageRunId} is not a check stage of the pinned version`);
    const running = stores.stages.transition(stageRunId, ['starting'], 'running', {
      lease: { owner: frame.owner, ttlMs: this.timing.leaseTtlMs },
      runId,
      now: this.now(),
    });
    if (!running.ok) throw new AttemptStop(frame.stop ?? { kind: 'aborted', reason: 'superseded' });
    await this.deps.eventBus
      .emitGlobal({
        kind: 'stage_run.running',
        data: { stageRunId, workflowRunId: runId, name: stage.name, stageKey: stage.key, instancePath: instance.instancePath, attemptNo: frame.req.attemptNo, version: running.row.version },
      } as unknown as AgentEvent)
      .catch(() => undefined);
    // Inside a mount_per_item map item the command runs in the item's worktrees (P05 §4.1).
    const item = mapItemPlacement(state, instance);
    const placed = item ? runForItem(run, item) : run;
    const workspace = await runWorkspace(this.deps.workspaceManager, run);
    const outcome = await runCheck({
      stage,
      run: placed,
      primaryDir: placed.systemVars?.workingDirectory ?? this.deps.workspaceManager.getWorkingDirectory(workspace),
      scope: templateScope(compile(graph), state, instance, userVariables({ ...(run.variables ?? {}) })),
      scriptRunner: this.deps.scriptRunner,
      secrets: this.deps.workflowSecrets,
      signal: frame.ac.signal,
    });
    if (frame.stop) throw new AttemptStop(frame.stop);
    if (outcome.kind !== 'succeeded') return outcome;
    // running → validating: the output is the command's result (no contract to check).
    const validating = stores.stages.transition(stageRunId, ['running'], 'validating', { runId, now: this.now() });
    if (!validating.ok) throw new AttemptStop(frame.stop ?? { kind: 'aborted', reason: 'superseded' });
    return outcome;
  }

  /** The run, the pinned stage and everything an attempt (or an amendment) body needs. */
  private async context(frame: Frame, mode: AttemptMode, epoch: number): Promise<AttemptContext> {
    const { stores } = this.deps;
    const { runId, stageRunId } = frame.req;
    const run = await this.deps.runRepo.getById(runId);
    const state = stores.runStore.loadRunState(runId);
    const instance = state?.instances.find((i) => i.id === stageRunId);
    if (!state || !instance) throw new StageError('config_invalid', `Instance ${stageRunId} of run ${runId} does not exist`);
    // A planned stage (P08 §8) lives in its expansion's stored plan, next to the pinned version.
    const graph = graphForInstance(await this.deps.definitions.get(run.definitionVersionId), state, instance);
    const stage = graph.stages.find((s) => s.key === instance.stageKey) as AgentStage | undefined;
    if (!stage || stage.kind !== 'agent') throw new StageError('config_invalid', `Stage ${instance.stageKey} is not an agent stage of the pinned version`);
    const compiled = compile(graph);
    const loopInst = instance.scopeId ? state.instances.find((i) => i.id === instance.scopeId && i.loopState != null) : undefined;
    const loopNode = loopInst ? compiled.nodes.get(loopInst.stageKey) : undefined;
    const wrapUp = isWrapUp(instance);
    const k = loopInst ? (instance.iterationIndex ?? loopInst.loopState!.k + 1) : 0;
    const prompts: PromptDefinition[] =
      wrapUp && loopNode?.loop?.wrapUp
        ? [loopNode.loop.wrapUp.prompt]
        : k >= 1 && stage.followUpPrompts?.length
          ? stage.followUpPrompts
          : stage.prompts;

    const spec = stageSessionSpec(graph, stage, run).merged;
    // Inside a mount_per_item map item the stage works in the item's own
    // workspace and worktrees (P05 §4.1); everywhere else in the run's.
    const item = mapItemPlacement(state, instance);
    const itemWorkspace = item?.workspaceId ? await this.deps.workspaceManager.getExecutionWorkspace(item.workspaceId) : null;
    const placed = item && itemWorkspace ? runForItem(run, item) : run;
    const workspace = itemWorkspace ?? (await runWorkspace(this.deps.workspaceManager, run));
    // The run's primary mount, pinned by the lifecycle's `worktrees` phase (system values, never variables: W-06).
    const pinned = placed.systemVars?.workingDirectory;
    // An amendment has its own operation ids; an attempt continues its epoch's journal.
    const journal = frame.amend ? [] : stores.turns.list(stageRunId, `a${epoch}/`);
    const ctx: AttemptContext = {
      frame,
      run: placed,
      graph,
      stage,
      state,
      instance,
      compiled,
      ...(loopInst && loopNode ? { loop: { inst: loopInst, node: loopNode, k } } : {}),
      wrapUp,
      prompts,
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
      // A wrap-up is free text: its loop exposes it as output.wrapUp.
      contract: wrapUp
        ? { format: 'text', schema: undefined, extraction: 'auto', rules: [] }
        : {
            // A planner's output is its plan (P08 §8): json, against the plan schema of its `expands`.
            format: stage.expands ? 'json' : stage.output.format,
            schema: stage.expands ? expansionPlanJsonSchema(stage.expands) : stage.output.schema,
            extraction: stage.output.extraction,
            rules: stage.output.rules,
          },
      outputs: { native: [], submitted: [], texts: [] },
      outputText: '',
      submittedThisTurn: [],
      hookContext: [],
      journal,
      cursor: -1,
      opSeq: 1 + Math.max(-1, ...journal.filter((j) => j.opId.startsWith(`a${epoch}/operator/`)).map((j) => Number(j.opId.slice(`a${epoch}/operator/`.length)) || 0)),
      lastStopped: false,
    };
    return ctx;
  }

  // ── Session ──────────────────────────────────────────────────

  /** `run_sessions.session_key`: a session group's, else this instance's for the journal epoch. */
  private sessionKey(ctx: AttemptContext): string {
    if (ctx.stage.sessionGroup) return `group:${ctx.stage.sessionGroup}`;
    // A continuing body stage keeps one conversation across its loop's
    // iterations (its wrap-up included), replaced every `compactAfter`
    // iterations by a fresh one seeded with a digest (P05 §2.3).
    if (ctx.loop && (ctx.stage.sessionReuse === 'continue' || ctx.wrapUp)) {
      return `loop:${ctx.loop.inst.id}/${ctx.stage.key}#c${compactionGeneration(ctx)}`;
    }
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
      workingDirectory: ctx.run.systemVars?.workingDirectory,
    });
    const { merged: spec, binding } = stageSessionSpec(ctx.graph, ctx.stage, ctx.run);
    const composed = await composer.compose({
      owner,
      conversationId,
      mode: create ? 'create' : 'resume',
      spec,
      bindingSpec: binding,
      agent: { baseLayer: resolverLayer(ctx.graph.workflow.session), bindingLayer: resolverLayer(binding) },
      agentSnapshot: snapshot,
      workspace: ctx.workspace,
      exposure,
      projectId: ctx.run.projectId ?? ctx.graph.workflow.projectId ?? undefined,
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
    ctx.frame.disposeSession = () => composed.dispose();
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
    for (let i = 0; i < ctx.prompts.length; i++) {
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
        const usage = asUsage((event.data ?? {}) as Record<string, unknown>);
        ctx.trace?.usage(usage);
        this.deps.post(runId, { type: 'usage_tick', stageRunId, attemptNo, usage });
      }
      // Tool calls are a loop signal (P05 §2.5): counted where they start.
      if (event.kind === 'harness.tool_start' && !frame.amend) {
        this.deps.post(runId, { type: 'usage_tick', stageRunId, attemptNo, usage: { toolCalls: 1 } });
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
      ctx.cursor = Math.max(ctx.cursor, ctx.journal.findIndex((j) => j.opId === t.opId));
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
    // An admitted attempt holds its provider's flow key for all its turns (P07 WP-7.2); an amendment has no admission.
    const options: SendPromptOptions = {
      ...baseOptions,
      ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
      ...(admittedOn(frame, composed!.provider) ? { admitted: true } : {}),
    };
    const turnId = this.deps.composer.beginTurn(owner!, frame.conversationId!, options, {
      policy: composed!.turnPolicy,
      // A workflow tool blocking on a run gives the attempt's keys back meanwhile (ECON-R7).
      yieldKeys: () => {
        if (!frame.ticket) return undefined;
        frame.ticket.pause();
        return () => this.resumeTicket(frame);
      },
    });
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
      const settled: SettledTurn = { role: t.role, content: partial?.content ?? response?.content ?? '', stopped: true };
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
    await this.replayOperatorTurns(ctx);
    const queue = ctx.frame.operatorQueue;
    while (queue.length > 0) {
      const op = queue.shift()!;
      // A deterministic id: a later resume of the epoch replays it (ENGINE-R7).
      const turn = await this.turn(ctx, {
        opId: `${opPrefix}/operator/${ctx.opSeq++}`,
        role: 'operator',
        text: op.prompt,
        prepare: true,
        attachments: await this.attachmentsOf(ctx, op.attachmentIds),
        agentMode: op.agentMode,
        ...this.nativeSchema(ctx),
      });
      this.recordOutput(ctx, turn);
    }
  }

  /**
   * The operator turns the epoch took next, in journal order (a resumed
   * attempt): a settled one replays; one that never settled died with its
   * message, which is dropped rather than re-sent blind.
   */
  private async replayOperatorTurns(ctx: AttemptContext): Promise<void> {
    const prefix = `a${ctx.epoch}/operator/`;
    for (let next = ctx.journal[ctx.cursor + 1]; next?.opId.startsWith(prefix); next = ctx.journal[ctx.cursor + 1]) {
      if (next.entry.state === 'settled') {
        this.recordOutput(ctx, await this.turn(ctx, { opId: next.opId, role: 'operator', text: '' }));
        continue;
      }
      this.deps.stores.turns.discard(ctx.frame.req.stageRunId, next.opId);
      ctx.cursor += 1;
      await this.emitSession(ctx, 'stage_run.operator_message_dropped', { count: 1, reason: 'interrupted' });
    }
  }

  /** A native structured-output stage asks for its schema on every output-producing turn (ENGINE-R8). */
  private nativeSchema(ctx: AttemptContext): { outputSchema?: Record<string, unknown> } {
    return ctx.contract.format === 'json' && ctx.strategies[0] === 'native' ? { outputSchema: ctx.contract.schema ?? { type: 'object' } } : {};
  }

  /**
   * The operator stopped the answer this stage would hand on (ENGINE-R16):
   * it is not the output. The stage waits — its deadline paused — for the
   * operator's next message, and carries on from its answer.
   */
  private async afterStoppedTurn(ctx: AttemptContext): Promise<void> {
    const { frame } = ctx;
    while (ctx.lastStopped) {
      if (frame.operatorQueue.length === 0 && !ctx.journal[ctx.cursor + 1]?.opId.startsWith(`a${ctx.epoch}/operator/`)) {
        await this.emitSession(ctx, 'harness.session_info', {
          infoType: 'turn_stopped',
          message: 'The answer was stopped before it finished; send a message to continue the stage.',
        });
        frame.parkedSince = this.now();
        try {
          await new Promise<void>((resolve) => {
            if (frame.stop || frame.operatorQueue.length > 0) return resolve();
            frame.operatorWaiter = resolve;
          });
        } finally {
          frame.parkedMs += this.now() - (frame.parkedSince ?? this.now());
          frame.parkedSince = undefined;
          frame.lastProgressAt = this.now();
        }
        if (frame.stop) throw new AttemptStop(frame.stop);
      }
      await this.operatorTurns(ctx, `a${ctx.epoch}`);
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

  /**
   * An output-producing turn (prompt, operator, repair, revision) settled:
   * the LATEST one is the output (ENGINE-R8) — an earlier turn's submission
   * never outlives a revision. A turn that produced nothing keeps the one before.
   */
  private recordOutput(ctx: AttemptContext, turn: SettledTurn): void {
    const produced = turn.content.trim().length > 0 || turn.structuredOutput !== undefined || turn.submitted !== undefined;
    if (produced) {
      ctx.outputs = {
        native: turn.structuredOutput !== undefined ? [turn.structuredOutput] : [],
        submitted: turn.submitted !== undefined ? [turn.submitted] : [],
        texts: [turn.content],
      };
    }
    if (turn.content.trim().length > 0 || ctx.outputText.length === 0) ctx.outputText = turn.content;
    ctx.lastStopped = turn.stopped === true;
  }

  /** What the stage's templates read: context T of its enclosing loops (P05 §2.2). */
  private scopeOf(ctx: AttemptContext): Record<string, unknown> {
    const scope = templateScope(ctx.compiled, ctx.state, ctx.instance, userVariables(ctx.variables));
    // A waiting event wait this stage can read exposes its callback (P05 §4.3).
    const callbacks = this.deps.callbacks;
    const stages = scope['stages'] as Record<string, Record<string, unknown>> | undefined;
    if (callbacks && stages) {
      for (const inst of ctx.state.instances) {
        const view = stages[inst.stageKey];
        const wait = waitInterruptOf(inst);
        if (!view || inst.status !== 'waiting' || wait?.type !== 'event') continue;
        // The wait of this stage's own scope: same container AND the same iteration or map item (MAPWAIT-R3).
        if (inst.scopeId !== null && (inst.scopeId !== ctx.instance.scopeId || scopeIndexOf(inst) !== scopeIndexOf(ctx.instance))) continue;
        const cb = callbacks.forWait(ctx.run.id, inst.id, wait.eventKey);
        if (cb) stages[inst.stageKey] = { ...view, callbackUrl: cb.url, callbackToken: cb.token };
      }
    }
    return scope;
  }

  private render(ctx: AttemptContext, text: string): { rendered: string; unresolved: string[] } {
    const scope = this.scopeOf(ctx);
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
      const inst = ctx.state.instances.find(
        (i) => i.scopeId === ctx.instance.scopeId && i.iterationIndex === ctx.instance.iterationIndex && i.stageKey === key,
      );
      if (!inst || inst.status !== 'completed') continue;
      const name = ctx.graph.stages.find((s) => s.key === key)?.name ?? key;
      const text = typeof inst.output === 'string' ? inst.output : inst.output !== null && inst.output !== undefined ? JSON.stringify(inst.output, null, 2) : '';
      let body: string;
      if (mode === 'output') body = text || inst.summary || '';
      else if (mode === 'structured') body = `${inst.summary ?? ''}${inst.output !== null && typeof inst.output === 'object' ? `\n\n\`\`\`json\n${JSON.stringify(inst.output, null, 2)}\n\`\`\`` : ''}`;
      else body = inst.summary ?? (text.length > 3000 ? `${text.slice(0, 3000)}\n… (truncated)` : text);
      // A planner's context carries what its planned stages did (P08 §8).
      const x = ctx.state.instances.find(
        (i) => i.scopeId === ctx.instance.scopeId && i.iterationIndex === ctx.instance.iterationIndex && i.stageKey === expansionNodeKey(key),
      );
      const planned = (x?.output as { results?: Array<{ name: string; status: string; summary: string | null }> } | null)?.results;
      if (planned?.length) body += `\n\nPlanned stages:\n${planned.map((r) => `- ${r.name} (${r.status})${r.summary ? `: ${r.summary}` : ''}`).join('\n')}`;
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
    const context = [...this.contextBlocks(ctx), ...ctx.hookContext];
    await this.loopInputTurn(ctx);
    const prompts = ctx.prompts;
    // From the second iteration a body stage's turns are its iteration inputs (the run page shows each).
    const role: TurnRole = ctx.wrapUp ? 'wrap_up' : ctx.loop && ctx.loop.k >= 1 ? 'iteration_input' : 'prompt';
    const last = prompts.length - 1;
    for (let i = 0; i <= last; i++) {
      const prompt = prompts[i]!;
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
        role,
        text,
        prepare: true,
        ...(i === last && ctx.strategies[0] === 'native' ? { outputSchema: ctx.contract.schema ?? { type: 'object' } } : {}),
      });
      this.recordOutput(ctx, turn);
      // A message the operator sent meanwhile is the next turn (PD-3: never mid-turn).
      await this.operatorTurns(ctx, `a${ctx.epoch}`);
    }
  }

  /**
   * `continue_with_input` (P05 §2.3): the operator's message is sent, as an
   * operator turn, to every root stage of the iteration it is for, before
   * the stage's own prompts.
   */
  private async loopInputTurn(ctx: AttemptContext): Promise<void> {
    const loop = ctx.loop;
    const input = loop?.inst.loopState?.operatorInput;
    if (!loop || ctx.wrapUp || !input || input.forIteration !== loop.k) return;
    if (ctx.graph.edges.some((e) => e.to === ctx.stage.key)) return; // not a root of the body
    const turn = await this.turn(ctx, { opId: `a${ctx.epoch}/loop-input/${loop.k}`, role: 'operator', text: input.text, prepare: true });
    this.recordOutput(ctx, turn);
  }

  /**
   * `compactAfter` (P05 §2.3): the first turn of a new conversation
   * generation is seeded with a deterministic digest — the stage's first
   * prompt, one line per finished iteration, and its own last output, at
   * most 8 KB — recorded as a `digest` turn. No model call.
   */
  private async seedDigest(ctx: AttemptContext): Promise<void> {
    const loop = ctx.loop;
    const n = ctx.stage.compactAfter;
    if (!loop || !n || loop.k === 0 || loop.k % n !== 0 || ctx.stage.sessionReuse !== 'continue' || ctx.wrapUp) return;
    const opId = `a${ctx.epoch}/digest/${loop.k}`;
    if (this.deps.stores.turns.get(ctx.frame.req.stageRunId, opId)?.state === 'settled') return;
    const rows = ctx.state.iterations.filter((r) => r.stageRunId === loop.inst.id).sort((a, b) => a.k - b.k);
    const previous = ctx.state.instances.find((i) => i.scopeId === loop.inst.id && i.iterationIndex === loop.k - 1 && i.stageKey === ctx.stage.key);
    const lastOutput = previous ? (typeof previous.output === 'string' ? previous.output : JSON.stringify(previous.output ?? null)) : '';
    const first = ctx.stage.prompts[0] ? this.render(ctx, ctx.stage.prompts[0].text).rendered : '';
    const lines = rows.map((r) => {
      const held = Object.entries(r.exitValues)
        .filter(([, v]) => v === true)
        .map(([name]) => name);
      return `- iteration ${r.k + 1}: ${r.outcome}${held.length ? `, rules held: ${held.join(', ')}` : ''}${r.signals?.workspaceChanged === false ? ', no workspace change' : ''}`;
    });
    let digest = `## Conversation digest (the earlier conversation was compacted)\n### Task\n${first}\n### Iterations so far\n${lines.join('\n')}\n### Your last output\n${lastOutput}`;
    if (digest.length > 8192) digest = `${digest.slice(0, 8180)}\n… (cut)`;
    const now = this.now();
    this.deps.stores.turns.intent(ctx.frame.req.stageRunId, opId, {
      role: 'digest',
      policy: ctx.replayPolicy,
      now,
      message: {
        id: generateId(),
        sessionId: ctx.session!.id,
        role: 'user',
        content: digest,
        turnRole: 'digest',
        metadata: { stageRunId: ctx.frame.req.stageRunId, workflowRunId: ctx.frame.req.runId, opId, turnRole: 'digest' },
        complete: true,
      },
    });
    this.deps.stores.turns.settle(ctx.frame.req.stageRunId, opId, { role: 'digest', content: '' }, { now });
    ctx.recap = `${digest}\n\n---\n\n${ctx.recap ?? ''}`;
    await this.emitSession(ctx, 'harness.session_info', { infoType: 'conversation_compacted', message: `Conversation compacted at iteration ${loop.k + 1}` });
  }

  // ── Output contract, repairs, approval ───────────────────────

  private toValidating(ctx: AttemptContext): void {
    const r = this.deps.stores.stages.transition(ctx.frame.req.stageRunId, ['running'], 'validating', { runId: ctx.frame.req.runId, now: this.now() });
    if (!r.ok) throw new AttemptStop(ctx.frame.stop ?? { kind: 'aborted', reason: 'superseded' });
  }

  /** Back to `running`; the instance's version after the CAS. */
  private backToRunning(ctx: AttemptContext, from: 'validating' | 'awaiting_input'): number {
    const r = this.deps.stores.stages.transition(ctx.frame.req.stageRunId, [from], 'running', {
      lease: { owner: ctx.frame.owner, ttlMs: this.timing.leaseTtlMs },
      runId: ctx.frame.req.runId,
      now: this.now(),
    });
    if (!r.ok) throw new AttemptStop(ctx.frame.stop ?? { kind: 'aborted', reason: 'superseded' });
    return r.row.version;
  }

  /**
   * running → validating, the contract, and repair turns while the repair
   * budget lasts (G5 §3.4). Ends in `validating` with the checked output.
   */
  private async validate(ctx: AttemptContext): Promise<{ data?: unknown }> {
    const { stores } = this.deps;
    const { stageRunId, attemptNo } = ctx.frame.req;
    const maxRepairs = ctx.stage.repair?.maxRepairs ?? 2;
    await this.afterStoppedTurn(ctx);
    this.toValidating(ctx);
    for (;;) {
      const check = await checkOutputContract(ctx.contract, ctx.strategies, ctx.outputs, ctx.outputText, {
        logger: this.logger,
        scriptRunner: this.deps.scriptRunner,
        secrets: this.deps.workflowSecrets,
        workspacePath: ctx.workDir,
        stageRunId,
        scope: this.scopeOf(ctx),
      });
      this.recheck(ctx, 'validating');
      // A plan must also hold as a graph (P08 §8): a repair turn can fix it here; the expansion node checks it again.
      const plan = check.ok && ctx.stage.expands ? validateExpansion(check.data, ctx.stage.expands, new Set(ctx.graph.stages.map((s) => s.key))) : null;
      const planIssue = plan && !plan.ok ? plan.message : null;
      // The hard rules held: the judge rules score the output (P05 §4.4).
      const verdict = check.ok && !planIssue ? await this.judge(ctx, check.data) : null;
      if (check.ok && !planIssue && verdict === null) {
        if (check.data !== undefined) stores.attempts.update(stageRunId, attemptNo, { structuredOutput: check.data });
        return check.data !== undefined ? { data: check.data } : {};
      }
      const failures = planIssue ? [planIssue] : check.ok ? verdict!.failures : check.failures;
      const error = planIssue ? classified('output_schema', planIssue) : check.ok ? verdict!.error : check.error;
      const used = stores.attempts.get(stageRunId, attemptNo)?.repairCount ?? 0;
      if (used >= maxRepairs) throw new AttemptStop({ kind: 'failed', error });
      // validating → running with repair_count + 1, then the repair turn.
      this.backToRunning(ctx, 'validating');
      const n = stores.attempts.incrementRepair(stageRunId, attemptNo);
      if (n === null) throw new AttemptStop(ctx.frame.stop ?? { kind: 'aborted', reason: 'superseded' });
      await this.emitSession(ctx, 'stage_run.repairing', { repair: n, failures });
      const turn = await this.turn(ctx, {
        opId: `a${ctx.epoch}/repair/${n - 1}`,
        role: 'repair',
        text: repairMessage(failures, ctx.strategies, ctx.contract.format),
        prepare: true,
        ...this.nativeSchema(ctx),
      });
      this.recordOutput(ctx, turn);
      await this.afterStoppedTurn(ctx);
      this.toValidating(ctx);
    }
  }

  /**
   * The judge rules (P05 §4.4): each scores the output 0-10 against its
   * rubric in a fresh, tool-less, single-turn conversation (the stage's
   * model unless the rule names one; the working-tree diff with
   * `include: ['diff']`). Every verdict is kept on the attempt
   * (`stage_attempts.judge`, one entry per rule per repair round) and its
   * usage counts toward the stage budget. Null when every judge passed.
   */
  private async judge(ctx: AttemptContext, data: unknown): Promise<{ failures: string[]; error: ClassifiedError } | null> {
    const rules = ctx.contract.rules.filter((r): r is Extract<(typeof ctx.contract.rules)[number], { type: 'judge' }> => r.type === 'judge');
    if (rules.length === 0) return null;
    const { stores } = this.deps;
    const { stageRunId, attemptNo, runId } = ctx.frame.req;
    const round = stores.attempts.get(stageRunId, attemptNo)?.repairCount ?? 0;
    const recorded = (stores.attempts.get(stageRunId, attemptNo)?.judge as JudgeRecord[] | null | undefined) ?? [];
    // What the epoch's earlier attempts judged (a resume replays their outputs).
    const earlier = stores.attempts
      .listByStageRun(stageRunId)
      .filter((a) => a.attemptNo >= ctx.epoch && a.attemptNo < attemptNo)
      .flatMap((a) => (a.judge as JudgeRecord[] | null | undefined) ?? []);
    const failures: string[] = [];
    const verdicts: JudgeRecord[] = [];
    const output = data !== undefined ? JSON.stringify(data, null, 2) : ctx.outputText;
    // Verdicts are kept per judged output: a revision or an operator turn changes it, and is judged again (ENGINE-R9).
    const outputHash = digest(output);
    for (const [index, rule] of rules.entries()) {
      // A verdict on this very output already recorded (a resumed attempt) is not asked again.
      const prior = [...recorded, ...earlier].find((v) => v.outputHash === outputHash && v.rule === index);
      const v = prior ?? (await this.askJudge(ctx, rule, index, round, output));
      verdicts.push({ ...v, outputHash });
      if (!v.passed) {
        const why = v.reasons.length ? v.reasons.join('; ') : 'no reasons given';
        failures.push(rule.message ?? `The judge scored the output ${v.score ?? 'unreadable'}/10 (needs ${rule.threshold}): ${why}`);
      }
    }
    stores.attempts.update(stageRunId, attemptNo, { judge: [...recorded.filter((v) => v.outputHash !== outputHash), ...verdicts] });
    await this.emitSession(ctx, 'stage_run.judged', { round, verdicts, workflowRunId: runId });
    if (failures.length === 0) return null;
    return { failures, error: classified('judge_below_threshold', `The judge did not pass the output: ${failures.join('; ')}`, { details: { failures } }) };
  }

  private async askJudge(
    ctx: AttemptContext,
    rule: { rubric: string; threshold: number; model?: string | undefined; include?: Array<'diff'> | undefined },
    index: number,
    round: number,
    output: string,
  ): Promise<JudgeRecord> {
    const { harness } = this.deps;
    const { stageRunId, attemptNo, runId } = ctx.frame.req;
    const spec = stageSessionSpec(ctx.graph, ctx.stage, ctx.run).merged;
    const conversationId = `judge-${stageRunId}-${attemptNo}-${round}-${index}`;
    let diff = '';
    if (rule.include?.includes('diff') && this.deps.scriptRunner) {
      const r = await this.deps.scriptRunner.run('git', ['diff', 'HEAD'], { cwd: ctx.workDir, timeout: 30_000 }).catch(() => null);
      diff = r && r.exitCode === 0 ? r.stdout.slice(0, 20_000) : '';
    }
    const prompt =
      `You are a strict reviewer. Score the output below from 0 to 10 against the rubric. Uncertain means a lower score.\n\n` +
      `## Rubric\n${this.render(ctx, rule.rubric).rendered}\n\n## Output\n${output.slice(0, 50_000)}\n` +
      (diff ? `\n## Working-tree diff\n\`\`\`diff\n${diff}\n\`\`\`\n` : '') +
      `\nAnswer with one \`\`\`json block: {"score": <0-10>, "reasons": ["<what falls short>", ...]}`;
    let unsubscribe: (() => void) | undefined;
    try {
      await harness.createConversation({
        conversationId,
        ...((rule.model ?? spec.model) ? { model: rule.model ?? spec.model } : {}),
        ...(spec.harnessType ? { harnessType: spec.harnessType } : {}),
        workingDirectory: ctx.workDir,
        streaming: false,
        permissionMode: 'plan',
        availableTools: [],
        excludedTools: ['*'],
        maxTurns: 1,
        systemMessage: { mode: 'append', content: 'You judge the output of an automated workflow stage. You have no tools.' },
      });
      // Its spend is the stage's (the budget counts it).
      unsubscribe = harness.onConversationEvent(conversationId, (event: AgentEvent) => {
        if (event.kind === 'harness.usage') {
          this.deps.post(runId, { type: 'usage_tick', stageRunId, attemptNo, usage: asUsage((event.data ?? {}) as Record<string, unknown>) });
        }
      });
      // A tool-less judge turn changes nothing; its verdict is kept on the attempt and a resumed attempt reuses it.
      // Inside the attempt's admission: the judge turn runs on the attempt's provider slot (P07 WP-7.2) —
      // only when it runs on that provider (a judge model routed elsewhere takes its own provider's permit).
      const judgeProvider = (await harness.resolveProvider?.({ conversationId })) ?? (rule.model ? undefined : ctx.composed?.provider);
      const response = await harness.sendPromptAndWait(conversationId, prompt, undefined, ctx.frame.ac.signal, admittedOn(ctx.frame, judgeProvider) ? { admitted: true } : undefined); // durability-ok: tool-less judge, verdict journalled on stage_attempts.judge
      const parsed = parseJudgeReply(response?.content ?? '');
      const score = parsed?.score ?? null;
      return { round, rule: index, score, threshold: rule.threshold, reasons: parsed?.reasons ?? ['The judge answer could not be read'], passed: score !== null && score >= rule.threshold };
    } catch (err) {
      if (ctx.frame.stop) throw new AttemptStop(ctx.frame.stop);
      throw this.harnessFailure(ctx, err);
    } finally {
      unsubscribe?.();
      await harness.deleteConversation(conversationId).catch(() => undefined);
    }
  }

  /** Whether a successor reads this stage's summary (only then a text stage pays a summary turn). */
  private successorWantsSummary(ctx: AttemptContext): boolean {
    const key = ctx.stage.key;
    return ctx.graph.stages.some(
      (s) =>
        s.key !== key &&
        s.kind === 'agent' &&
        s.context.mode === 'summary' &&
        (s.context.from ? s.context.from.includes(key) : ctx.graph.edges.some((e) => e.from === key && e.to === s.key)),
    );
  }

  /**
   * The stage's summary under its `output.summary` policy (P07 WP-7.1,
   * `summaries.ts`): `none` writes none; `llm` is written after completion
   * by the `summarize` effect (undefined here); `auto` is deterministic,
   * with one summary turn only when a successor reads the summary and the
   * text output is over 6,000 characters.
   */
  private async summary(ctx: AttemptContext, data: unknown): Promise<string | undefined> {
    const name = ctx.stage.name;
    const policy = ctx.stage.output.summary;
    if (ctx.wrapUp || policy === 'none' || policy === 'llm') return undefined;
    if (ctx.contract.format === 'json') return jsonSummary(name, data);
    if (ctx.outputText.length <= AUTO_SUMMARY_TURN_THRESHOLD || !this.successorWantsSummary(ctx)) return autoSummary(name, 'text', data, ctx.outputText);
    // Per output: a revised output gets its own summary, never the replay of the first one (ENGINE-R10).
    const turn = await this.turn(ctx, { opId: `a${ctx.epoch}/summary/${digest(ctx.outputText)}`, role: 'summary', text: summaryPrompt(name), expect: 'validating' });
    return turn.content.trim().length > 0 ? turn.content : autoSummary(name, 'text', data, ctx.outputText);
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
      // A resumed attempt also replays the operator turns its epoch took here.
      if (ctx.frame.operatorQueue.length === 0 && !ctx.journal[ctx.cursor + 1]?.opId.startsWith(`a${ctx.epoch}/operator/`)) {
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
    const approval = ctx.wrapUp ? undefined : ctx.stage.approval;
    if (approval) {
      const maxRounds = approval.maxRounds;
      for (let round = 1; ; round++) {
        this.backToRunning(ctx, 'validating');
        // A round the epoch already answered with changes (a resumed attempt):
        // its revision replays where it was taken, in journal order (ENGINE-R1).
        let turn = await this.journalledRevision(ctx, round);
        if (!turn) {
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
            // The full output this gate shows: a verdict given while no frame was alive answers only this output.
            outputHash: digest(ctx.outputText),
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
          turn = await this.turn(ctx, {
            opId: `a${ctx.epoch}/review/${round}/${digest(feedback)}`,
            role: 'approval_feedback',
            text: feedback,
            prepare: true,
            ...this.nativeSchema(ctx),
          });
        }
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
   * The revision turn of review round `round` when it is the epoch's next
   * journalled turn: a settled one replays; one that died in flight is
   * dropped (its feedback is not re-sent blind) and the round asks again.
   */
  private async journalledRevision(ctx: AttemptContext, round: number): Promise<SettledTurn | null> {
    const next = ctx.journal[ctx.cursor + 1];
    if (!next?.opId.startsWith(`a${ctx.epoch}/review/${round}/`)) return null;
    if (next.entry.state === 'settled') return this.turn(ctx, { opId: next.opId, role: 'approval_feedback', text: '' });
    this.deps.stores.turns.discard(ctx.frame.req.stageRunId, next.opId);
    ctx.cursor += 1;
    return null;
  }

  /**
   * Park the frame on a human (the approval gate): running → awaiting_input
   * (lease cleared, B-2), the admission slot handed back, the deadline
   * paused (B-7); the actor's `deliver_input` resumes it. A verdict carried
   * by a resume attempt answers the gate it was given for — the same review
   * round showing the same output — without parking (ENGINE-R1); any other
   * gate asks again.
   */
  private async awaitVerdict(ctx: AttemptContext, interruptData: Record<string, unknown>): Promise<ApprovalVerdict> {
    const { frame } = ctx;
    const carried = frame.carriedVerdict;
    if (carried) {
      frame.carriedVerdict = undefined;
      if (carried.reviewRound === interruptData['reviewRound'] && carried.outputHash === interruptData['outputHash']) return carried;
      await this.emitSession(ctx, 'harness.session_info', {
        infoType: 'verdict_superseded',
        message: 'The verdict given after the restart was for another review round or output; the stage asks again.',
      });
    }
    const verdict = await this.parkFrame(ctx, interruptData, false);
    const version = this.backToRunning(ctx, 'awaiting_input');
    // After the transition, with its version: a client never shows the gate's buttons again for it (CONVINV-R18).
    await this.emitSession(ctx, 'stage_run.input_received', { outcome: verdict.outcome, version });
    return verdict;
  }

  /**
   * `inTurn`: a gate inside a turn (tool permission, question, plan) — the
   * provider's process lives on while it waits, so the attempt keeps its
   * provider key and gives back only the others (ECON-R4).
   */
  private async parkFrame(ctx: AttemptContext, interruptData: Record<string, unknown>, inTurn: boolean): Promise<ApprovalVerdict> {
    const { frame } = ctx;
    const { stageRunId, runId } = frame.req;
    // The waiter is in place BEFORE the instance is written `awaiting_input`:
    // a verdict may arrive the moment it is (ENGINE-R2), and finds it.
    let answer!: (verdict: ApprovalVerdict | null) => void;
    const answered = new Promise<ApprovalVerdict | null>((resolve) => {
      answer = resolve;
    });
    const waiter: Waiter = { resolve: answer };
    if (frame.stop) answer(null);
    else frame.waiter = waiter;
    frame.parkedSince = this.now();
    const r = this.deps.stores.stages.transition(stageRunId, ['running'], 'awaiting_input', {
      patch: { interruptData },
      runId,
      now: this.now(),
    });
    if (!r.ok) {
      if (frame.waiter === waiter) frame.waiter = undefined;
      frame.parkedSince = undefined;
      throw new AttemptStop(frame.stop ?? { kind: 'aborted', reason: 'superseded' });
    }
    await this.emitSession(ctx, 'stage_run.awaiting_input', { interruptData, version: r.row.version });
    const provider = ctx.composed?.provider;
    frame.ticket?.pause(inTurn && provider ? { keep: [providerFlowKey(provider)] } : undefined);
    let verdict: ApprovalVerdict | null;
    try {
      verdict = await answered;
    } finally {
      if (frame.waiter === waiter) frame.waiter = undefined;
      frame.parkedMs += this.now() - (frame.parkedSince ?? this.now());
      frame.parkedSince = undefined;
      frame.lastProgressAt = this.now();
    }
    if (!verdict && frame.turnStop && !frame.stop) {
      // The operator stopped the turn this gate belongs to: the gate ends, the turn returns.
      await this.resumeTicket(frame);
      this.backToRunning(ctx, 'awaiting_input');
      throw new TurnStoppedAtGate();
    }
    if (!verdict) throw new AttemptStop(frame.stop ?? { kind: 'aborted', reason: 'superseded' });
    await this.resumeTicket(frame);
    return verdict;
  }

  /** Take the given-back flow keys again; an attempt stopped while it waits for them ends (ECON-R6). */
  private async resumeTicket(frame: Frame): Promise<void> {
    try {
      await frame.ticket?.resume(frame.ac.signal);
    } catch {
      throw new AttemptStop(frame.stop ?? { kind: 'aborted', reason: 'superseded' });
    }
  }

  /** A tool permission, question or plan gate inside a turn (the StageGatePort `park`). */
  private async park(ctx: AttemptContext, _turn: TurnContext, data: Record<string, unknown>, prompt: string): Promise<InterruptResolution> {
    try {
      const verdict = await this.parkFrame(ctx, { ...data, prompt }, true);
      const version = this.backToRunning(ctx, 'awaiting_input');
      await this.emitSession(ctx, 'stage_run.input_received', { outcome: verdict.outcome, version });
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
        secrets: this.deps.workflowSecrets,
        workspacePath: ctx.workDir,
        stageRunId,
        scope: this.scopeOf(ctx),
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
      templateScope: this.scopeOf(ctx),
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
      // Outside the mounts, so autoCommit never picks the attachments up (C-8).
      const dir = path.join(ctx.workspace.rootPath, 'hook-attachments', ctx.stage.key);
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

/**
 * A stage's session: the workflow's, then the run-wide overrides of the
 * invocation (model, provider, effort) and the run's uploaded skills and
 * sub-agents, then the stage's own, then the run's per-stage model. The
 * binding-site layer (runtime scalars) is everything but the workflow's.
 */
/** One judge verdict (`stage_attempts.judge` holds them, per rule per repair round). */
interface JudgeRecord {
  round: number;
  rule: number;
  /** The digest of the output judged (what a resumed attempt matches on). */
  outputHash?: string;
  score: number | null;
  threshold: number;
  reasons: string[];
  passed: boolean;
}

/** The judge's final JSON block: {score, reasons}. */
export function parseJudgeReply(text: string): { score: number | null; reasons: string[] } | null {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!);
  const candidates = blocks.length ? blocks.reverse() : [text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as { score?: unknown; reasons?: unknown };
      const score = typeof v.score === 'number' && Number.isFinite(v.score) ? Math.max(0, Math.min(10, v.score)) : null;
      const reasons = Array.isArray(v.reasons) ? v.reasons.filter((r): r is string => typeof r === 'string') : [];
      return { score, reasons };
    } catch {
      /* the next candidate */
    }
  }
  return null;
}

/** Which conversation generation a continuing body stage is on (a new one every `compactAfter` iterations). */
function compactionGeneration(ctx: Pick<AttemptContext, 'loop' | 'stage' | 'wrapUp'>): number {
  const n = ctx.stage.compactAfter;
  if (!ctx.loop || !n) return 0;
  // A wrap-up continues the conversation of the loop's last iteration, not a generation after it (LOOP-R8).
  const k = ctx.wrapUp ? (ctx.loop.inst.loopState?.k ?? ctx.loop.k) : ctx.loop.k;
  return Math.floor(k / n);
}

export function stageSessionSpec(
  graph: WorkflowGraph,
  stage: Pick<AgentStage, 'key' | 'session'>,
  run: Pick<WorkflowRun, 'runOverrides' | 'stageOverrides' | 'systemVars'>,
): { merged: SessionSpec; binding: SessionSpec } {
  const o = run.runOverrides ?? {};
  const sv = run.systemVars ?? {};
  const runLayer: SessionSpec = {
    ...(o.model ? { model: o.model } : {}),
    ...(o.harnessType ? { harnessType: o.harnessType as SessionSpec['harnessType'] } : {}),
    ...(o.reasoningEffort ? { reasoningEffort: o.reasoningEffort as SessionSpec['reasoningEffort'] } : {}),
    ...(sv.skillDirectories?.length ? { skills: { directories: [...sv.skillDirectories] } } : {}),
    ...(sv.customAgents?.length ? { customAgents: sv.customAgents.map((a) => ({ ...a })) } : {}),
  };
  const model = run.stageOverrides?.find((x) => x.stageKey === stage.key)?.model;
  const stageRunLayer: SessionSpec | undefined = model ? { model } : undefined;
  return {
    merged: resolveSessionSpec(graph.workflow.session, runLayer, stage.session, stageRunLayer),
    binding: resolveSessionSpec(runLayer, stage.session, stageRunLayer),
  };
}

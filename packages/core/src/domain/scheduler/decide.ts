// ────────────────────────────────────────────────────────────────
// decide(graph, state, msg, now) → Decision[]   (P03 WP-3.3, G5 §5.3)
//
// The whole scheduling semantics of a run, as one pure function:
//   1. the message is applied (an attempt settled, a timer fired, a
//      command, a lease expired, usage reported, …);
//   2. the run is settled: skip cascade and readiness to a fixed point
//      (join policies, guards, `cancelRemaining`), the run budget, launches
//      within `maxParallel` and `sessionGroup` exclusivity, then the run
//      status (running ↔ waiting, or finalizing/cancelling with its
//      outcome once the scope is terminal).
//
// Determinism (checked by replay): no clock (`now` is an argument), no
// randomness (jitter is drawn by the store when it persists a timer), ids
// are UUIDv5, instances are visited in `instance_path` order, and nothing
// outside `state` is read. Every decision is also applied to a working copy
// of the state, so later steps of the same call see earlier ones — the
// store applies the same list, in order, in one transaction.
//
// Failure precedence on `attempt_settled(failed)` (G5 §3.5):
//   0. the instance is no longer in an attempt state (cancel or pause won
//      the race): the outcome is dropped
//   1. REPAIR happened in the executor; a repairable error here means the
//      repairs ran out
//   2. RETRY for a transient error, a safely replayable interruption, or an
//      exhausted repair with `restartOnExhausted` — within `retryOn`,
//      `maxAttempts` (failed attempts only), `totalMs` and the budgets;
//      an unclassified error is retried at most once
//   3. an interruption that may not be replayed pauses (never fails)
//   4. ROUTE: an active failure-handler edge → failed (readiness runs it)
//   5. EXHAUSTED: onExhausted pause (default) or fail
//   A human rejection skips 2 and the pause of 5: it fails (and routes).
//
// The P05 kinds settle in the same fixed point as readiness: loops
// (loops.ts), maps (maps.ts: item scopes, merges), waits (waits.ts: no
// executor, no admission slot) and sub-workflows (subworkflows.ts: a child
// run). Their effects follow the same shape: a decision dispatched after
// the commit, answered by a message.
// ────────────────────────────────────────────────────────────────

import { isTerminalStageRunState, type RunCommand, type WorkflowRunState } from '@generatorai/workflow-spec';
import { classified, type ClassifiedError } from '../errors/StageError.js';
import type { CompiledNode, CompiledWorkflow } from '../workflow-graph/compile.js';
import { instanceId } from './ids.js';
import {
  activeScopes,
  enforceLoopBudgets,
  isLoopCommand,
  loopCommand,
  onIterationCaptured,
  onIterationRestored,
  onLoopWallClock,
  settleLoops,
  wrapUpAllowance,
} from './loops.js';
import { mapBusy, mapScopes, onMapItemMerged, onMapItemPrepared, onMapSnapshotTaken, settleMaps } from './maps.js';
import { evalCondition, predState, readiness, type PredState } from './readiness.js';
import {
  onChildSettled,
  onChildStarted,
  onChildStartFailed,
  propagateToChildren,
  settleSubworkflows,
  subworkflowBusy,
} from './subworkflows.js';
import { approveWait, onWaitTimer, settleWaits } from './waits.js';
import { isWrapUp } from './scope.js';
import { computeScopeOutcome } from './terminal.js';
import type {
  ApprovalVerdict,
  AttemptMode,
  AttemptOutcome,
  Decision,
  InstanceState,
  NewInstance,
  OperatorTurn,
  RunMessage,
  RunOutcome,
  RunRecord,
  RunState,
} from './types.js';
import {
  addUsage,
  applyPatch,
  ATTEMPT_STATES,
  byPath,
  cancelInstance,
  failInstance,
  inAttempt,
  overBudget,
  PAUSE_TTL_MS,
  pauseInstance,
  stageEvent,
  stopInstance,
  Working,
} from './working.js';

export { ATTEMPT_STATES, PAUSE_TTL_MS } from './working.js';

/** The verdict a relaunched attempt carries (an approval that arrived with no live frame). */
function verdictOf(interruptData: unknown): ApprovalVerdict | undefined {
  if (interruptData && typeof interruptData === 'object' && 'verdict' in interruptData) {
    return (interruptData as { verdict?: ApprovalVerdict }).verdict;
  }
  return undefined;
}

/** The operator message a retried attempt sends as its next turn (P03b: a message to a paused stage). */
function operatorTurnOf(interruptData: unknown): OperatorTurn | undefined {
  if (interruptData && typeof interruptData === 'object' && 'operatorTurn' in interruptData) {
    return (interruptData as { operatorTurn?: OperatorTurn }).operatorTurn;
  }
  return undefined;
}

/** What a new attempt carries from the instance: a verdict, an operator turn, or nothing. */
function carriedOverrides(interruptData: unknown): { verdict?: ApprovalVerdict; operatorTurn?: OperatorTurn } | undefined {
  const verdict = verdictOf(interruptData);
  const operatorTurn = operatorTurnOf(interruptData);
  if (!verdict && !operatorTurn) return undefined;
  return { ...(verdict ? { verdict } : {}), ...(operatorTurn ? { operatorTurn } : {}) };
}

/** Retry delay before jitter for the n-th retry (n ≥ 1), G5 §3.2. */
export function retryBaseDelayMs(policy: { initialDelayMs: number; backoffMultiplier: number; maxDelayMs: number }, n: number): number {
  return Math.min(policy.maxDelayMs, Math.round(policy.initialDelayMs * policy.backoffMultiplier ** Math.max(0, n - 1)));
}

/** A failure-handler edge out of the instance is active for it (G5 §3.5 ROUTE). */
function hasFailureRoute(w: Working, inst: InstanceState, node: CompiledNode): boolean {
  const asFailed = { ...inst, status: 'failed' as const };
  return node.outgoing.some((e) => {
    if (!e.handlesFailure || (e.on !== 'failure' && e.on !== 'completion' && e.on !== 'always')) return false;
    if (!e.when) return true;
    const r = evalCondition(e.when, w.scopeFor(asFailed));
    return r.ok && r.holds;
  });
}

/** The attempt failed: the precedence of G5 §3.5. `inst` is in an attempt state. */
function applyFailure(w: Working, inst: InstanceState, err: ClassifiedError, safeReplay: boolean): void {
  const node = w.node(inst);
  if (!node) return failInstance(w, inst, err);
  const errorPatch = { error: err.message, errorClass: err.class, errorCode: err.code };

  if (err.code === 'rejected_by_human') return failInstance(w, inst, err, 'rejected');

  // 2. RETRY
  const restartable = err.class === 'repairable' && node.repair.restartOnExhausted;
  const retryableClass = err.class === 'transient' || (err.class === 'interrupted' && safeReplay) || restartable;
  const codeAllowed = node.retry.retryOn ? node.retry.retryOn.includes(err.code) : true;
  const deadlinePassed = node.timeouts.totalMs !== undefined && inst.startedAt !== null && w.now - inst.startedAt >= node.timeouts.totalMs;
  const budgetOut = overBudget(inst.usage, node.budget) || overBudget(w.run.usage, w.run.budget);
  const attemptsLeft = inst.failedAttempts < node.retry.maxAttempts && !(err.unclassified && inst.failedAttempts >= 2);
  if (retryableClass && codeAllowed && attemptsLeft && !deadlinePassed && !budgetOut) {
    if (w.run.status === 'paused') {
      // The run is paused: the retry waits for its resume.
      return pauseInstance(w, inst, 'run_paused', false);
    }
    if (w.run.status === 'running' || w.run.status === 'waiting') {
      const mode: AttemptMode = restartable ? 'restart' : err.class === 'interrupted' ? 'resume' : node.retry.mode;
      w.transition(inst, 'retry_wait', { statusReason: `retry:${mode}`, ...errorPatch });
      w.timer('retry', inst, retryBaseDelayMs(node.retry, inst.failedAttempts), inst.version, {
        jitter: node.retry.jitter,
        ...(err.retryAfterMs !== undefined ? { minDelayMs: err.retryAfterMs } : {}),
      });
      return;
    }
  }

  // 3. An interruption that may not be replayed waits for an operator.
  if (err.class === 'interrupted') {
    w.transition(inst, 'paused', { statusReason: `interrupted:${err.code}`, ...errorPatch });
    stageEvent(w, 'stage_run.paused', inst, { reason: `interrupted:${err.code}` });
    if (w.run.unattended) w.timer('pause_ttl', inst, PAUSE_TTL_MS, inst.version);
    return;
  }

  // 4. ROUTE
  if (hasFailureRoute(w, inst, node)) return failInstance(w, inst, err);

  // 5. EXHAUSTED
  if (node.onExhausted === 'fail') return failInstance(w, inst, err);
  const reason = err.class === 'deterministic' ? `deterministic:${err.code}` : 'retries_exhausted';
  w.transition(inst, 'paused', { statusReason: reason, ...errorPatch });
  stageEvent(w, 'stage_run.paused', inst, { reason });
  if (w.run.unattended) w.timer('pause_ttl', inst, PAUSE_TTL_MS, inst.version);
}

// ── Run-level building blocks ─────────────────────────────────────

function pauseWholeRun(w: Working, mode: 'drain' | 'interrupt', statusReason: string): void {
  w.runTransition('paused', { statusReason });
  propagateToChildren(w, 'pause');
  for (const inst of w.sorted()) {
    // The run's own pause TTL covers these (PD-2).
    if (inst.status === 'ready' || inst.status === 'retry_wait') pauseInstance(w, inst, 'run_paused', false);
    else if (mode === 'interrupt' && inAttempt(inst.status)) pauseInstance(w, inst, 'run_paused', false);
  }
  w.emit('workflow_run.paused', { reason: statusReason });
  // The operator is told the run ran out of budget (a push notification, P07 WP-7.3).
  if (statusReason === 'budget_exhausted') w.emit('workflow_run.budget_exhausted', { usage: w.run.usage, budget: w.run.budget, name: w.run.name });
  if (w.run.unattended) w.timer('pause_ttl', null, PAUSE_TTL_MS, w.run.version);
}

function resumeWholeRun(w: Working): void {
  w.runTransition('running', { statusReason: null });
  propagateToChildren(w, 'resume');
  w.push({ t: 'cancel_timer', kind: 'pause_ttl', stageRunId: null });
  for (const inst of w.sorted()) {
    if (inst.status === 'paused' && inst.statusReason === 'run_paused') {
      w.transition(inst, 'ready', { statusReason: 'resume' });
      w.push({ t: 'cancel_timer', kind: 'pause_ttl', stageRunId: inst.id });
    }
  }
  w.emit('workflow_run.resumed', {});
}

/** Instances compensated when the run fails or is cancelled: completed ones that declare it, last completed first. */
function compensationOrder(w: Working, outcome: RunOutcome): string[] {
  if (outcome === 'completed') return [];
  return w
    .sorted()
    .filter((i) => i.status === 'completed' && w.node(i)?.compensates)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || byPath(b, a))
    .map((i) => i.id);
}

function cancelWholeRun(w: Working, statusReason: string, outcome?: RunOutcome): void {
  if (w.run.status === 'finalizing') {
    // Post-processing is skipped; compensation still runs.
    w.runTransition('cancelling', { statusReason, outcome: 'cancelled' });
    w.push({ t: 'finalize', outcome: 'cancelled', compensate: compensationOrder(w, 'cancelled') });
    w.emit('workflow_run.cancelling', {});
    return;
  }
  w.runTransition('cancelling', { statusReason, ...(outcome ? { outcome } : {}) });
  for (const inst of w.sorted()) {
    if (!isTerminalStageRunState(inst.status)) cancelInstance(w, inst, 'run_cancelled');
  }
  w.push({ t: 'cancel_timer' });
  w.emit('workflow_run.cancelling', {});
}

// ── Message handlers ──────────────────────────────────────────────

function onAttemptSettled(w: Working, msg: Extract<RunMessage, { type: 'attempt_settled' }>): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || msg.attemptNo !== inst.currentAttempt || inst.attemptStatus !== 'running') return; // stale or duplicate
  const outcome: AttemptOutcome = msg.outcome;
  if (outcome.usage) w.usage(inst, outcome.usage);

  // 0. Cancel or pause won the race: the outcome is dropped.
  if (!inAttempt(inst.status)) return w.settleAttempt(inst, 'aborted');

  switch (outcome.kind) {
    case 'succeeded': {
      // Success is reported from `validating`, once the output contract held.
      // Anything else is an unvalidated output: never a completion (F-5).
      if (inst.status !== 'validating') {
        const err = classified('output_schema', 'The attempt reported success without validating its output');
        w.settleAttempt(inst, 'failed', err);
        return applyFailure(w, inst, err, false);
      }
      w.settleAttempt(inst, 'succeeded');
      w.transition(inst, 'completed', {
        statusReason: null,
        outputData: outcome.output.data ?? null,
        outputText: outcome.output.text ?? null,
        summary: outcome.output.summary ?? null,
        artifactManifest: outcome.output.artifactManifest ?? null,
        error: null,
        errorClass: null,
        errorCode: null,
      });
      w.push({ t: 'cancel_timer', stageRunId: inst.id });
      stageEvent(w, 'stage_run.completed', inst);
      // An `llm` summary is written after completion (P07 WP-7.1): only the successors that read it wait.
      if (w.node(inst)?.summary === 'llm' && outcome.output.summary === undefined) w.push({ t: 'summarize', stageRunId: inst.id });
      return;
    }
    case 'failed':
      w.settleAttempt(inst, outcome.error.class === 'interrupted' ? 'interrupted' : 'failed', outcome.error);
      return applyFailure(w, inst, outcome.error, outcome.safeReplay === true);
    case 'aborted':
      w.settleAttempt(inst, 'aborted');
      if (outcome.reason === 'budget') {
        return applyFailure(w, inst, classified('budget_exceeded', 'The stage budget is exhausted'), false);
      }
      w.transition(inst, 'paused', { statusReason: `aborted:${outcome.reason}` });
      stageEvent(w, 'stage_run.paused', inst, { reason: `aborted:${outcome.reason}` });
      return;
  }
}

/** Gates answered inside a turn: their turn never settled, so a lost frame cannot be resumed by a verdict alone. */
const IN_TURN_GATES = new Set(['tool_permission', 'question', 'plan_review']);

function onFrameLost(w: Working, msg: Extract<RunMessage, { type: 'frame_lost' }>): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || msg.attemptNo !== inst.currentAttempt || inst.attemptStatus !== 'running' || inst.status !== 'awaiting_input') return;
  w.settleAttempt(inst, 'aborted');
  const kind = inst.interruptData && typeof inst.interruptData === 'object' ? (inst.interruptData as { kind?: unknown }).kind : undefined;
  if (typeof kind !== 'string' || !IN_TURN_GATES.has(kind)) return; // a completion review stays parked; its verdict starts a resume attempt
  // G5 §3.10 step 4: the request died with its turn. A resume re-sends the turn, which asks again.
  w.transition(inst, 'paused', { statusReason: 'interrupted', interruptData: null });
  stageEvent(w, 'stage_run.paused', inst, { reason: 'interrupted' });
}

function onUsage(w: Working, msg: Extract<RunMessage, { type: 'usage_tick' }>): void {
  const inst = w.get(msg.stageRunId);
  if (!inst) return;
  w.usage(inst, msg.usage);
  const node = w.node(inst);
  if (!node || !inAttempt(inst.status) || msg.attemptNo !== inst.currentAttempt || inst.attemptStatus !== 'running') return;
  // A wrap-up spends its own allowance, outside its loop's cap (P05 §2.3).
  const loopNode = isWrapUp(inst) && inst.scopeId ? w.node(w.get(inst.scopeId)!) : undefined;
  const loopState = inst.scopeId ? w.get(inst.scopeId)?.loopState : null;
  const budget = loopNode?.loop && loopState ? wrapUpAllowance(loopNode.loop, loopNode, loopState) : node.budget;
  if (!loopNode) enforceLoopBudgets(w, inst);
  if (!inAttempt(inst.status)) return; // the loop's hard cap stopped it
  if (overBudget(inst.usage, budget)) {
    const err = classified('budget_exceeded', 'The stage budget is exhausted');
    w.settleAttempt(inst, 'failed', err);
    const attemptNo = inst.currentAttempt;
    applyFailure(w, inst, err, false);
    w.push({ t: 'abort', stageRunId: inst.id, attemptNo, reason: 'budget' });
  }
}

function onTimer(w: Working, msg: Extract<RunMessage, { type: 'timer_fired' }>): void {
  const inst = msg.stageRunId ? w.get(msg.stageRunId) : undefined;
  switch (msg.kind) {
    case 'retry':
      if (inst?.status === 'retry_wait') {
        w.transition(inst, 'ready');
        stageEvent(w, 'stage_run.retrying', inst, { retryCount: inst.failedAttempts });
      }
      return;
    case 'queue_timeout':
      if (inst?.status === 'ready' && inst.attemptStatus === 'running') {
        const err = classified('queue_timeout', 'No execution slot became free in time');
        stopInstance(w, inst, 'failed', { error: err.message, errorClass: err.class, errorCode: err.code }, 'queue_timeout');
        stageEvent(w, 'stage_run.failed', inst, { error: err.message });
      }
      return;
    case 'pause_ttl': {
      if (inst) {
        const parkedLoop = inst.status === 'awaiting_input' && inst.loopState?.phase === 'parked';
        // An unattended approval or event wait without a timeout expires the same way (P5-41).
        const waitingWait = inst.status === 'waiting' && w.node(inst)?.wait !== undefined;
        if (inst.status === 'paused' || parkedLoop || waitingWait) {
          failInstance(w, inst, classified('pause_expired', 'Paused longer than the unattended pause limit'), 'pause_expired');
          if (parkedLoop) w.instancePatch(inst, { loopState: { ...inst.loopState!, phase: 'done', exitAction: 'fail', exitReason: 'pause_expired', parkedSince: null } });
        }
        return;
      }
      if (w.run.status !== 'paused') return;
      // PD-2: an unattended run paused past its limit fails.
      for (const i of w.sorted()) {
        if (!isTerminalStageRunState(i.status)) cancelInstance(w, i, 'pause_expired');
      }
      w.runTransition('finalizing', { statusReason: 'pause_expired', outcome: 'failed' });
      w.push({ t: 'cancel_timer' });
      w.push({ t: 'finalize', outcome: 'failed', compensate: compensationOrder(w, 'failed') });
      return;
    }
    case 'run_budget_wall_clock':
      if (!inst && (w.run.status === 'running' || w.run.status === 'waiting')) pauseWholeRun(w, 'drain', 'budget_exhausted');
      return;
    case 'wait_timer':
    case 'wait_timeout':
      if (inst) onWaitTimer(w, inst, msg.kind);
      return;
    case 'loop_wall_clock':
      if (inst) onLoopWallClock(w, inst);
      return;
  }
}

function onLeaseExpired(w: Working, msg: Extract<RunMessage, { type: 'lease_expired' }>): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || !inAttempt(inst.status) || inst.attemptStatus !== 'running') return;
  if (inst.leaseOwner !== null && inst.leaseOwner !== msg.owner) return; // renewed or re-claimed since
  const err = classified('lease_expired', 'The executor stopped renewing its lease');
  w.settleAttempt(inst, 'interrupted', err);
  applyFailure(w, inst, err, msg.safeReplay === true);
}

const RUN_LIVE: readonly WorkflowRunState[] = ['running', 'waiting'];

function onCommand(w: Working, command: RunCommand, actor?: string): void {
  // An event was stored by the supervisor before this message (idempotent,
  // outside the actor); the settle below lets a waiting wait take it.
  if (command.command === 'deliver_event') {
    if (!RUN_LIVE.includes(w.run.status) && w.run.status !== 'paused') return w.reject('invalid_state', `the run is ${w.run.status}`);
    return;
  }
  if (command.instanceId === undefined) {
    if (command.expectedVersion !== undefined && command.expectedVersion !== w.run.version) {
      return w.reject('version_conflict', `run version is ${w.run.version}, not ${command.expectedVersion}`);
    }
    switch (command.command) {
      case 'pause':
        if (!RUN_LIVE.includes(w.run.status)) return w.reject('invalid_state', `cannot pause a ${w.run.status} run`);
        return pauseWholeRun(w, command.mode, `user:${command.mode}`);
      case 'resume':
        if (w.run.status !== 'paused') return w.reject('invalid_state', `cannot resume a ${w.run.status} run`);
        return resumeWholeRun(w);
      case 'cancel':
        if (!['created', 'starting', 'running', 'waiting', 'paused', 'finalizing'].includes(w.run.status)) {
          return w.reject('invalid_state', `cannot cancel a ${w.run.status} run`);
        }
        return cancelWholeRun(w, 'user_cancel');
      default:
        return w.reject('invalid_command', `${command.command} needs an instanceId`);
    }
  }

  const inst = w.find(command.instanceId);
  if (!inst) return w.reject('not_found', `no instance ${command.instanceId}`);
  if (!['created', 'starting', 'running', 'waiting', 'paused'].includes(w.run.status)) {
    return w.reject('invalid_state', `the run is ${w.run.status}`);
  }
  if (command.expectedVersion !== undefined && command.expectedVersion !== inst.version) {
    return w.reject('version_conflict', `instance version is ${inst.version}, not ${command.expectedVersion}`);
  }
  const refuse = () => w.reject('invalid_state', `cannot ${command.command} a ${inst.status} instance`);

  // A loop takes its own decisions (P05 §2.3); a work node takes none of them.
  const node = w.node(inst);
  // A wait is approved (approval waits) or cancelled; a map is cancelled; a
  // sub-workflow is cancelled, paused or resumed (on its child run).
  if (node?.wait) {
    if (command.command === 'cancel') return isTerminalStageRunState(inst.status) ? refuse() : cancelInstance(w, inst, 'user_cancel');
    if (command.command !== 'approve') return w.reject('invalid_command', `${command.command} does not apply to a wait; approve (an approval wait) or cancel it`);
    const refusal = approveWait(w, inst, command.outcome, command.data, actor);
    return refusal ? w.reject('invalid_state', refusal) : undefined;
  }
  if (node?.map) {
    if (command.command === 'cancel') return isTerminalStageRunState(inst.status) ? refuse() : cancelInstance(w, inst, 'user_cancel');
    return w.reject('invalid_command', `${command.command} does not apply to a map; act on its items, or cancel it`);
  }
  if (node?.subworkflow) {
    if (command.command === 'cancel') return isTerminalStageRunState(inst.status) ? refuse() : cancelInstance(w, inst, 'user_cancel');
    if (command.command === 'pause' || command.command === 'resume') {
      const cs = inst.containerState;
      if (inst.status !== 'running' || cs?.kind !== 'subworkflow' || !cs.childRunId || cs.phase !== 'running') return refuse();
      w.push({ t: 'child_command', stageRunId: inst.id, childRunId: cs.childRunId, command: command.command });
      return;
    }
    return w.reject('invalid_command', `${command.command} does not apply to a sub-workflow; act on its child run, or cancel, pause or resume it`);
  }
  if (node?.loop) {
    if (command.command === 'cancel') {
      if (isTerminalStageRunState(inst.status)) return refuse();
      return cancelInstance(w, inst, 'user_cancel');
    }
    if (!isLoopCommand(command.command)) return w.reject('invalid_command', `${command.command} does not apply to a loop; use its decisions (grant iterations, raise budget, continue, accept, fail)`);
    const refusal = loopCommand(w, inst, command);
    return refusal ? w.reject('invalid_state', refusal) : undefined;
  }
  if (isLoopCommand(command.command) && command.command !== 'fail') {
    return w.reject('invalid_command', `${command.command} applies to a loop stage only`);
  }

  switch (command.command) {
    case 'pause':
      if (inst.status === 'ready' || inst.status === 'retry_wait' || inAttempt(inst.status)) return pauseInstance(w, inst, 'user_paused');
      return refuse();
    case 'resume':
      if (inst.status !== 'paused') return refuse();
      w.transition(inst, 'ready', { statusReason: 'resume' });
      w.push({ t: 'cancel_timer', kind: 'pause_ttl', stageRunId: inst.id });
      stageEvent(w, 'stage_run.resumed', inst);
      return;
    case 'retry': {
      if (inst.status !== 'paused') return refuse();
      const operatorTurn: OperatorTurn | undefined = command.promptOverride
        ? {
            prompt: command.promptOverride,
            ...(command.attachmentIds?.length ? { attachmentIds: command.attachmentIds } : {}),
            ...(command.agentMode ? { agentMode: command.agentMode } : {}),
          }
        : undefined;
      w.transition(inst, 'ready', { statusReason: `retry:${command.mode}`, ...(operatorTurn ? { interruptData: { operatorTurn } } : {}) });
      w.push({ t: 'cancel_timer', kind: 'pause_ttl', stageRunId: inst.id });
      stageEvent(w, 'stage_run.retrying', inst, { retryCount: inst.failedAttempts });
      return;
    }
    case 'skip':
      if (inst.status !== 'paused' && inst.status !== 'ready') return refuse();
      stopInstance(
        w,
        inst,
        'skipped',
        {
          skipReason: 'operator',
          skipCauseId: null,
          gateAs: command.as,
          statusReason: 'operator',
          ...(command.as === 'completed' && command.output !== undefined ? { outputData: command.output } : {}),
        },
        'cancel',
      );
      stageEvent(w, 'stage_run.skipped', inst, { reason: 'operator' });
      return;
    case 'fail':
      if (inst.status !== 'paused') return refuse();
      return failInstance(w, inst, classified('config_invalid', 'Failed by an operator'), 'operator');
    case 'cancel':
      if (isTerminalStageRunState(inst.status)) return refuse();
      return cancelInstance(w, inst, 'user_cancel');
    case 'approve': {
      if (inst.status !== 'awaiting_input') return refuse();
      const verdict: ApprovalVerdict = {
        outcome: command.outcome,
        ...(command.feedback !== undefined ? { feedback: command.feedback } : {}),
        ...(command.data !== undefined ? { data: command.data } : {}),
      };
      if (verdict.outcome === 'rejected') {
        const err = classified('rejected_by_human', command.feedback ?? 'Rejected by the reviewer');
        const frame = inst.attemptStatus === 'running';
        w.settleAttempt(inst, 'failed', err);
        failInstance(w, inst, err, 'rejected');
        if (frame) w.push({ t: 'abort', stageRunId: inst.id, attemptNo: inst.currentAttempt, reason: 'cancel' });
        return;
      }
      if (inst.attemptStatus === 'running') {
        // The executor frame is alive: it resumes the parked turn itself.
        w.push({ t: 'deliver_input', stageRunId: inst.id, attemptNo: inst.currentAttempt, verdict });
        return;
      }
      // No frame survived (a restart): a resume attempt carries the verdict.
      const prior = inst.interruptData && typeof inst.interruptData === 'object' ? (inst.interruptData as Record<string, unknown>) : {};
      w.transition(inst, 'ready', { statusReason: 'resume', interruptData: { ...prior, verdict } });
      return;
    }
  }
}

function onFinalized(w: Working, msg: Extract<RunMessage, { type: 'finalized' }>): void {
  if (w.run.status === 'finalizing') {
    const completed = w.run.outcome === 'completed' && msg.ok;
    w.runTransition(completed ? 'completed' : 'failed', {
      ...(msg.ok ? {} : { statusReason: 'finalize_failed', error: msg.error ?? 'Finalization failed' }),
      ...(w.run.outcome === 'completed' && !msg.ok ? { outcome: 'failed' as const } : {}),
    });
    w.push({ t: 'cancel_timer' });
    if (completed) w.emit('workflow_run.completed', {});
    else w.emit('workflow_run.failed', { error: msg.error ?? w.run.statusReason ?? 'The run failed' });
    // Every waiter keys on this one (W-63): the lifecycle is done, post-processing included.
    w.emit('workflow_run.finalized', { status: completed ? 'completed' : 'failed' });
    return;
  }
  if (w.run.status === 'cancelling') {
    w.runTransition('cancelled', msg.ok ? undefined : { error: msg.error ?? 'Compensation failed' });
    w.push({ t: 'cancel_timer' });
    w.emit('workflow_run.cancelled', {});
    w.emit('workflow_run.finalized', { status: 'cancelled' });
  }
}

// ── Settle: readiness, admission, run status ──────────────────────

function ensureRootInstances(w: Working): void {
  const rows: NewInstance[] = [];
  for (const key of w.graph.rootKeys) {
    if (w.sibling({ scopeId: null, iterationIndex: null }, key)) continue;
    const node = w.graph.nodes.get(key)!;
    rows.push({ id: instanceId(w.run.id, key), stageKey: key, kind: node.kind, name: node.name, instancePath: key, scopeId: null });
  }
  w.addInstances(rows);
}

/** Predecessors of a join that only lead into it, recursively up the exclusive chain (G5 §4.1). */
function exclusiveLosers(w: Working, node: CompiledNode): string[] {
  const targets = new Set([node.key]);
  const losers: string[] = [];
  let frontier = node.incoming.map((e) => e.from);
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const key of [...new Set(frontier)].sort()) {
      if (targets.has(key)) continue;
      const n = w.graph.nodes.get(key);
      if (!n || n.outgoing.length === 0 || !n.outgoing.every((e) => targets.has(e.to))) continue;
      targets.add(key);
      losers.push(key);
      next.push(...n.incoming.map((e) => e.from));
    }
    frontier = next;
  }
  return losers.sort();
}

function failConditionError(w: Working, inst: InstanceState, message: string): void {
  w.transition(inst, 'ready');
  failInstance(w, inst, classified('condition_error', message));
}

/**
 * Readiness to a fixed point in every active scope: the top level and the
 * current iteration of every running loop (edges never cross a scope, so a
 * predecessor is the same key in the same scope).
 */
function resolveReadiness(w: Working): boolean {
  let any = false;
  let changed = true;
  while (changed) {
    changed = false;
    const scopes = [...activeScopes(w), ...mapScopes(w)];
    const pending = scopes.flatMap((s) => w.scopeInstances(s.containerId, s.iteration).filter((i) => i.status === 'pending'));
    for (const inst of pending) {
      if (inst.status !== 'pending') continue;
      const node = w.node(inst);
      if (!node) continue;
      const preds: Array<{ instance: InstanceState; state: PredState; error?: string }> = [];
      for (const e of node.incoming) {
        const p = w.sibling(inst, e.from);
        if (!p) continue;
        preds.push({ instance: p, ...predState(p, e, w.scopeFor) });
      }
      const r = readiness(node, preds);
      if (r.kind === 'blocked') continue;
      changed = true;
      any = true;
      if (r.kind === 'skip') {
        w.transition(inst, 'skipped', { skipReason: r.reason, skipCauseId: r.causeId });
        stageEvent(w, 'stage_run.skipped', inst, { reason: r.reason });
        continue;
      }
      if (r.kind === 'fail') {
        failConditionError(w, inst, r.message);
        continue;
      }
      if (node.guard) {
        const g = evalCondition(node.guard, w.guardScope(inst));
        if (!g.ok) {
          failConditionError(w, inst, g.message);
          continue;
        }
        if (!g.holds) {
          w.transition(inst, 'skipped', { skipReason: 'guard_false', skipCauseId: null });
          stageEvent(w, 'stage_run.skipped', inst, { reason: 'guard_false' });
          continue;
        }
      }
      if (w.run.skipKeys?.includes(inst.stageKey)) {
        w.transition(inst, 'skipped', { skipReason: 'operator', skipCauseId: null, statusReason: 'operator' });
        stageEvent(w, 'stage_run.skipped', inst, { reason: 'operator' });
        continue;
      }
      // A reader of a summary still being written waits for `summary_ready` (P07 WP-7.1).
      if (awaitsSummary(w, inst, node)) continue;
      w.transition(inst, 'ready', { statusReason: null });
      if (node.join.mode !== 'all' && node.join.cancelRemaining) {
        for (const key of exclusiveLosers(w, node)) {
          const loser = w.sibling(inst, key);
          if (loser && !isTerminalStageRunState(loser.status)) cancelInstance(w, loser, 'cancelled_loser', 'cancelled_loser');
        }
      }
    }
  }
  return any;
}

function attemptModeFor(inst: InstanceState): AttemptMode {
  const reason = inst.statusReason ?? '';
  if (reason === 'retry:restart') return 'restart';
  if (reason === 'retry:resume') return 'resume';
  return inst.currentAttempt === 0 ? 'fresh' : 'resume';
}

function admit(w: Working): void {
  const live = w.sorted().filter((i) => w.admitted(i));
  let capacity = w.graph.maxParallel - live.length;
  const busyGroups = new Set<string>();
  for (const i of w.sorted()) {
    const group = w.node(i)?.sessionGroup;
    if (group && (w.admitted(i) || i.status === 'awaiting_input')) busyGroups.add(group);
  }
  for (const inst of w.sorted()) {
    if (capacity <= 0) break;
    if (inst.status !== 'ready' || w.admitted(inst)) continue;
    const node = w.node(inst);
    // Only work nodes run attempts; a container starts its scopes (P05).
    if (!node || node.class !== 'work') continue;
    if (node.sessionGroup && busyGroups.has(node.sessionGroup)) continue;
    w.createAttempt(inst, attemptModeFor(inst), carriedOverrides(inst.interruptData));
    w.push({ t: 'launch', stageRunId: inst.id, attemptNo: inst.currentAttempt });
    w.timer('queue_timeout', inst, node.timeouts.queueMs, inst.currentAttempt, { jitter: 'none' });
    capacity -= 1;
    if (node.sessionGroup) busyGroups.add(node.sessionGroup);
  }
}

function settle(w: Working): void {
  if (w.run.status === 'cancelling') {
    if (w.run.outcome === null && !w.sorted().some((i) => i.attemptStatus === 'running')) {
      w.runPatch({ outcome: 'cancelled' });
      w.push({ t: 'finalize', outcome: 'cancelled', compensate: compensationOrder(w, 'cancelled') });
    }
    return;
  }
  if (!RUN_LIVE.includes(w.run.status)) return;

  ensureRootInstances(w);
  // Readiness and the containers feed each other (a new scope has ready
  // roots; a finished scope settles its loop or map item; a ready wait arms,
  // a delivered event completes it): run them to a fixed point.
  for (let i = 0; i < 256; i++) {
    const a = resolveReadiness(w);
    const b = settleLoops(w);
    const c = settleMaps(w);
    const d = settleWaits(w);
    const e = settleSubworkflows(w);
    if (!a && !b && !c && !d && !e) break;
  }

  const roots = w.roots();
  if (roots.every((i) => isTerminalStageRunState(i.status))) {
    const outcome = computeScopeOutcome(w.graph, roots, w.scopeFor);
    if (outcome === 'cancelled') {
      w.runTransition('cancelling', { outcome });
      w.push({ t: 'cancel_timer' });
      w.push({ t: 'finalize', outcome, compensate: compensationOrder(w, outcome) });
      w.emit('workflow_run.cancelling', {});
      return;
    }
    w.runTransition('finalizing', { outcome });
    w.push({ t: 'cancel_timer' });
    w.push({ t: 'finalize', outcome, compensate: compensationOrder(w, outcome) });
    return;
  }

  if (overBudget(w.run.usage, w.run.budget)) {
    // An exhausted run budget refuses new launches (G5 §2.11): the run drains.
    pauseWholeRun(w, 'drain', 'budget_exhausted');
    return;
  }

  admit(w);

  // Busy: a work node in an attempt or admitted, a loop or map with an
  // effect in flight, or a sub-workflow whose child works. A wait is not.
  const busy = w.sorted().some((i) => {
    const node = w.node(i);
    if (node?.class === 'work') return inAttempt(i.status) || i.status === 'ready' || summaryPending(w, i);
    if (i.status === 'running' && i.loopState != null && ['starting', 'settling', 'restoring'].includes(i.loopState.phase)) return true;
    return mapBusy(i) || subworkflowBusy(i);
  });
  if (busy && w.run.status === 'waiting') w.runTransition('running');
  else if (!busy && w.run.status === 'running') w.runTransition('waiting');
}

// ── Summaries written after completion (P07 WP-7.1) ────────────────

/** A completed stage whose `llm` summary is still being written. */
function summaryPending(w: Working, inst: InstanceState): boolean {
  return inst.status === 'completed' && inst.summary === null && w.node(inst)?.summary === 'llm';
}

/** Whether a stage reading its sources' summaries must wait for one still being written. */
function awaitsSummary(w: Working, inst: InstanceState, node: CompiledNode): boolean {
  if (node.context?.mode !== 'summary') return false;
  const from = node.context.from ?? node.incoming.map((e) => e.from);
  return from.some((key) => {
    const src = w.sibling(inst, key);
    return !!src && summaryPending(w, src);
  });
}

function onSummaryReady(w: Working, msg: Extract<RunMessage, { type: 'summary_ready' }>): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || !summaryPending(w, inst)) return; // a duplicate, or the instance moved on (a fork, a re-run)
  if (msg.usage) w.usage(inst, msg.usage);
  w.instancePatch(inst, { summary: msg.summary });
  stageEvent(w, 'stage_run.summary_ready', inst);
}

// ── Entry point ───────────────────────────────────────────────────

/** THE scheduler: the decisions one message causes. Pure and deterministic. */
export function decide(graph: CompiledWorkflow, state: RunState, msg: RunMessage, now: number): Decision[] {
  const w = new Working(graph, state, now);
  switch (msg.type) {
    case 'start':
      if (w.run.status === 'created') {
        w.runTransition('starting');
        w.emit('workflow_run.starting', {});
        w.push({ t: 'prepare' });
      }
      break;
    case 'prepared':
      if (w.run.status === 'starting') {
        w.runTransition('running');
        w.emit('workflow_run.running', {});
        if (w.run.budget?.maxWallClockMs !== undefined) {
          w.timer('run_budget_wall_clock', null, w.run.budget.maxWallClockMs, w.run.version, { jitter: 'none' });
        }
      }
      break;
    case 'prepare_failed':
      if (w.run.status === 'starting') {
        w.runTransition('failed', { statusReason: `setup:${msg.phase}`, outcome: 'failed', error: msg.error });
        w.push({ t: 'cancel_timer' });
        w.emit('workflow_run.failed', { error: msg.error });
        w.emit('workflow_run.finalized', { status: 'failed' });
      }
      break;
    case 'attempt_settled':
      onAttemptSettled(w, msg);
      break;
    case 'usage_tick':
      onUsage(w, msg);
      break;
    case 'timer_fired':
      onTimer(w, msg);
      break;
    case 'lease_expired':
      onLeaseExpired(w, msg);
      break;
    case 'frame_lost':
      onFrameLost(w, msg);
      break;
    case 'command':
      onCommand(w, msg.command, msg.actor);
      break;
    case 'iteration_captured':
      onIterationCaptured(w, msg);
      break;
    case 'iteration_restored':
      onIterationRestored(w, msg);
      break;
    case 'map_snapshot_taken':
      onMapSnapshotTaken(w, msg);
      break;
    case 'map_item_prepared':
      onMapItemPrepared(w, msg);
      break;
    case 'map_item_merged':
      onMapItemMerged(w, msg);
      break;
    case 'child_started':
      onChildStarted(w, msg);
      break;
    case 'child_start_failed':
      onChildStartFailed(w, msg);
      break;
    case 'child_settled':
      onChildSettled(w, msg);
      break;
    case 'finalized':
      onFinalized(w, msg);
      break;
    case 'summary_ready':
      onSummaryReady(w, msg);
      break;
    case 'tick':
      break;
  }
  if (!w.rejected) settle(w);
  return w.decisions;
}

/**
 * The state after applying `decide`'s decisions — what a replay compares
 * (G5 §7.3) and what an in-memory store would hold. Pure.
 */
export function stateAfter(graph: CompiledWorkflow, state: RunState, msg: RunMessage, now: number): { decisions: Decision[]; state: RunState } {
  const decisions = decide(graph, state, msg, now);
  return { decisions, state: applyDecisions(state, decisions, now) };
}

/** Apply decisions to a state snapshot the way `RunStore.apply` applies them to the DB. Pure. */
export function applyDecisions(state: RunState, decisions: readonly Decision[], now: number): RunState {
  const run: RunRecord = { ...state.run, usage: { ...state.run.usage } };
  const instances = new Map(state.instances.map((i) => [i.id, { ...i, usage: { ...i.usage } }]));
  const iterations = [...(state.iterations ?? [])];
  const events = [...(state.events ?? [])];
  for (const d of decisions) {
    switch (d.t) {
      case 'transition': {
        const i = instances.get(d.id);
        if (!i) break;
        i.status = d.to;
        i.version += 1;
        if (d.patch) applyPatch(i, d.patch);
        if (isTerminalStageRunState(d.to) && i.completedAt === null) i.completedAt = now;
        if (!(ATTEMPT_STATES as readonly string[]).includes(d.to)) i.leaseOwner = null;
        break;
      }
      case 'create_instances':
        for (const r of d.rows) {
          if (instances.has(r.id)) continue;
          instances.set(r.id, {
            id: r.id, stageKey: r.stageKey, instancePath: r.instancePath, scopeId: r.scopeId, status: 'pending', statusReason: null,
            version: 0, currentAttempt: 0, attemptStatus: null, failedAttempts: 0, skipReason: null, skipCauseId: null, gateAs: null,
            output: null, summary: null, interruptData: null, errorCode: null, error: null, usage: {}, leaseOwner: null,
            iterationIndex: r.iterationIndex ?? null, itemIndex: r.itemIndex ?? null, itemKey: r.itemKey ?? null,
            loopState: null, containerState: null, startedAt: null, completedAt: null,
          });
        }
        break;
      case 'consume_event':
        events.splice(0, events.length, ...events.filter((e) => e.id !== d.eventId));
        break;
      case 'create_attempt': {
        const i = instances.get(d.stageRunId);
        if (!i) break;
        i.currentAttempt = d.attemptNo;
        i.attemptStatus = 'running';
        i.version += 1;
        if (i.startedAt === null) i.startedAt = now;
        break;
      }
      case 'settle_attempt': {
        const i = instances.get(d.stageRunId);
        if (!i || i.currentAttempt !== d.attemptNo) break;
        i.attemptStatus = d.status;
        if (d.status === 'failed' || d.status === 'interrupted') i.failedAttempts += 1;
        break;
      }
      case 'usage_rollup': {
        const i = instances.get(d.stageRunId);
        if (i) i.usage = addUsage(i.usage, d.usage);
        if (!d.scopeOnly) run.usage = addUsage(run.usage, d.usage);
        break;
      }
      case 'instance_patch': {
        const i = instances.get(d.id);
        if (!i || i.status !== d.status) break;
        i.version += 1;
        applyPatch(i, d.patch);
        break;
      }
      case 'record_iteration':
        if (!iterations.some((r) => r.stageRunId === d.row.stageRunId && r.k === d.row.k)) iterations.push(d.row);
        break;
      case 'run_transition':
        run.status = d.to;
        run.version += 1;
        if (d.patch?.statusReason !== undefined) run.statusReason = d.patch.statusReason;
        if (d.patch?.outcome !== undefined) run.outcome = d.patch.outcome;
        if (d.to === 'running' && run.startedAt === null) run.startedAt = now;
        break;
      case 'run_patch':
        if (d.patch.statusReason !== undefined) run.statusReason = d.patch.statusReason;
        if (d.patch.outcome !== undefined) run.outcome = d.patch.outcome;
        break;
      default:
        break;
    }
  }
  return { run, instances: [...instances.values()], iterations, events };
}

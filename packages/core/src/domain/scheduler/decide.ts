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
// ────────────────────────────────────────────────────────────────

import { isTerminalStageRunState, type RunCommand, type StageRunState, type WorkflowRunState } from '@generatorai/workflow-spec';
import { classified, type ClassifiedError } from '../errors/StageError.js';
import type { CompiledNode, CompiledWorkflow } from '../workflow-graph/compile.js';
import { instanceId, timerId } from './ids.js';
import { evalCondition, expressionScope, predState, readiness, type PredState } from './readiness.js';
import { computeScopeOutcome } from './terminal.js';
import type {
  ApprovalVerdict,
  AttemptMode,
  AttemptOutcome,
  AttemptStatus,
  Decision,
  InstancePatch,
  InstanceState,
  NewInstance,
  RunMessage,
  RunOutcome,
  RunPatch,
  RunRecord,
  RunState,
  SkipReason,
  TimerKind,
  Usage,
} from './types.js';

/** An attempt is in flight in these states (the executor owns them). */
export const ATTEMPT_STATES: readonly StageRunState[] = ['starting', 'running', 'validating'];
/** PD-2: an unattended pause expires after 72 h. */
export const PAUSE_TTL_MS = 72 * 3_600_000;

const inAttempt = (s: StageRunState) => ATTEMPT_STATES.includes(s);
const byPath = (a: InstanceState, b: InstanceState) => (a.instancePath < b.instancePath ? -1 : a.instancePath > b.instancePath ? 1 : 0);

function addUsage(a: Usage, b: Usage): Usage {
  const out: Usage = { ...a };
  for (const k of ['turns', 'costUsd', 'inputTokens', 'outputTokens'] as const) {
    if (b[k] !== undefined) out[k] = (out[k] ?? 0) + b[k]!;
  }
  return out;
}

function overBudget(usage: Usage, budget: { maxTurns?: number; maxCostUsd?: number } | undefined | null): boolean {
  if (!budget) return false;
  return (
    (budget.maxTurns !== undefined && (usage.turns ?? 0) >= budget.maxTurns) ||
    (budget.maxCostUsd !== undefined && (usage.costUsd ?? 0) >= budget.maxCostUsd)
  );
}

/** The verdict a relaunched attempt carries (an approval that arrived with no live frame). */
function verdictOf(interruptData: unknown): ApprovalVerdict | undefined {
  if (interruptData && typeof interruptData === 'object' && 'verdict' in interruptData) {
    return (interruptData as { verdict?: ApprovalVerdict }).verdict;
  }
  return undefined;
}

/** Retry delay before jitter for the n-th retry (n ≥ 1), G5 §3.2. */
export function retryBaseDelayMs(policy: { initialDelayMs: number; backoffMultiplier: number; maxDelayMs: number }, n: number): number {
  return Math.min(policy.maxDelayMs, Math.round(policy.initialDelayMs * policy.backoffMultiplier ** Math.max(0, n - 1)));
}

class Working {
  readonly decisions: Decision[] = [];
  readonly run: RunRecord;
  private readonly instances = new Map<string, InstanceState>();
  rejected = false;

  constructor(
    readonly graph: CompiledWorkflow,
    state: RunState,
    readonly now: number,
  ) {
    this.run = { ...state.run, usage: { ...state.run.usage } };
    for (const i of state.instances) this.instances.set(i.id, { ...i, usage: { ...i.usage } });
  }

  // ── reads ──

  sorted(): InstanceState[] {
    return [...this.instances.values()].sort(byPath);
  }

  roots(): InstanceState[] {
    return this.sorted().filter((i) => i.scopeId === null);
  }

  get(id: string): InstanceState | undefined {
    return this.instances.get(id);
  }

  /** By id, or by instance path (commands may name either). */
  find(ref: string): InstanceState | undefined {
    return this.instances.get(ref) ?? [...this.instances.values()].find((i) => i.instancePath === ref);
  }

  rootByKey(key: string): InstanceState | undefined {
    return [...this.instances.values()].find((i) => i.scopeId === null && i.stageKey === key);
  }

  node(inst: InstanceState): CompiledNode | undefined {
    return this.graph.nodes.get(inst.stageKey);
  }

  scopeFor = (parent?: InstanceState): Record<string, unknown> => expressionScope(this.run, [...this.instances.values()], parent);

  /** Has a live attempt: claimed (in an attempt state) or admitted and waiting to be claimed. */
  admitted(i: InstanceState): boolean {
    return i.attemptStatus === 'running' && (inAttempt(i.status) || i.status === 'ready');
  }

  // ── writes (decision + working copy) ──

  push(d: Decision): void {
    this.decisions.push(d);
  }

  transition(inst: InstanceState, to: StageRunState, patch?: InstancePatch, expectedVersion?: number): void {
    this.push({
      t: 'transition',
      id: inst.id,
      from: [inst.status],
      to,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      ...(patch ? { patch } : {}),
    });
    inst.status = to;
    inst.version += 1;
    if (patch) {
      if (patch.statusReason !== undefined) inst.statusReason = patch.statusReason;
      if (patch.skipReason !== undefined) inst.skipReason = patch.skipReason;
      if (patch.skipCauseId !== undefined) inst.skipCauseId = patch.skipCauseId;
      if (patch.gateAs !== undefined) inst.gateAs = patch.gateAs;
      if (patch.outputData !== undefined || patch.outputText !== undefined) inst.output = patch.outputData ?? patch.outputText ?? null;
      if (patch.summary !== undefined) inst.summary = patch.summary;
      if (patch.interruptData !== undefined) inst.interruptData = patch.interruptData;
      if (patch.errorCode !== undefined) inst.errorCode = patch.errorCode;
    }
    if (isTerminalStageRunState(to) && inst.completedAt === null) inst.completedAt = this.now;
    if (!(ATTEMPT_STATES as readonly string[]).includes(to)) inst.leaseOwner = null;
  }

  runTransition(to: WorkflowRunState, patch?: RunPatch, expectedVersion?: number): void {
    this.push({
      t: 'run_transition',
      from: [this.run.status],
      to,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      ...(patch ? { patch } : {}),
    });
    this.run.status = to;
    this.run.version += 1;
    if (patch?.statusReason !== undefined) this.run.statusReason = patch.statusReason;
    if (patch?.outcome !== undefined) this.run.outcome = patch.outcome;
    if (to === 'running' && this.run.startedAt === null) this.run.startedAt = this.now;
  }

  runPatch(patch: RunPatch): void {
    this.push({ t: 'run_patch', patch });
    if (patch.statusReason !== undefined) this.run.statusReason = patch.statusReason;
    if (patch.outcome !== undefined) this.run.outcome = patch.outcome;
  }

  settleAttempt(inst: InstanceState, status: Exclude<AttemptStatus, 'running'>, error?: ClassifiedError): void {
    if (inst.attemptStatus !== 'running') return;
    this.push({ t: 'settle_attempt', stageRunId: inst.id, attemptNo: inst.currentAttempt, status, ...(error ? { error } : {}) });
    inst.attemptStatus = status;
    if (status === 'failed' || status === 'interrupted') inst.failedAttempts += 1;
  }

  createAttempt(inst: InstanceState, mode: AttemptMode, overrides?: unknown): void {
    const attemptNo = inst.currentAttempt + 1;
    this.push({ t: 'create_attempt', stageRunId: inst.id, attemptNo, mode, ...(overrides !== undefined ? { overrides } : {}) });
    inst.currentAttempt = attemptNo;
    inst.attemptStatus = 'running';
    inst.version += 1;
    if (inst.startedAt === null) inst.startedAt = this.now;
  }

  usage(inst: InstanceState, usage: Usage): void {
    this.push({ t: 'usage_rollup', stageRunId: inst.id, usage });
    inst.usage = addUsage(inst.usage, usage);
    this.run.usage = addUsage(this.run.usage, usage);
  }

  timer(kind: TimerKind, inst: InstanceState | null, baseDelayMs: number, discriminator: number, extra: { jitter?: 'full' | 'equal' | 'none'; minDelayMs?: number } = {}): void {
    this.push({
      t: 'timer',
      id: timerId(this.run.id, inst?.id ?? null, kind, discriminator),
      kind,
      stageRunId: inst?.id ?? null,
      baseDelayMs,
      ...(extra.jitter ? { jitter: extra.jitter } : {}),
      ...(extra.minDelayMs !== undefined ? { minDelayMs: extra.minDelayMs } : {}),
    });
  }

  emit(kind: string, data: Record<string, unknown>): void {
    this.push({ t: 'emit', event: { kind, data: { workflowRunId: this.run.id, ...data } } });
  }

  reject(code: Extract<Decision, { t: 'reject' }>['code'], message: string): void {
    this.decisions.length = 0;
    this.push({ t: 'reject', code, message });
    this.rejected = true;
  }

  addInstances(rows: NewInstance[]): void {
    if (rows.length === 0) return;
    this.push({ t: 'create_instances', rows });
    for (const r of rows) {
      this.instances.set(r.id, {
        id: r.id,
        stageKey: r.stageKey,
        instancePath: r.instancePath,
        scopeId: r.scopeId,
        status: 'pending',
        statusReason: null,
        version: 0,
        currentAttempt: 0,
        attemptStatus: null,
        failedAttempts: 0,
        skipReason: null,
        skipCauseId: null,
        gateAs: null,
        output: null,
        summary: null,
        interruptData: null,
        errorCode: null,
        usage: {},
        leaseOwner: null,
        startedAt: null,
        completedAt: null,
      });
    }
  }
}

// ── Instance-level building blocks ────────────────────────────────

function stageEvent(w: Working, kind: string, inst: InstanceState, data: Record<string, unknown> = {}): void {
  w.emit(kind, { stageRunId: inst.id, name: w.node(inst)?.name ?? inst.stageKey, ...data });
}

/** Stop an instance: its live attempt is aborted AFTER the desired state is written. */
function stopInstance(w: Working, inst: InstanceState, to: 'paused' | 'cancelled' | 'skipped' | 'failed', patch: InstancePatch, reason: 'cancel' | 'pause' | 'loser' | 'queue_timeout'): void {
  // A frame may be running (an attempt state) or parked (awaiting_input); a
  // `ready` instance's attempt is only a queued launch.
  const live = inst.attemptStatus === 'running';
  const claimed = inst.status !== 'ready';
  w.transition(inst, to, patch);
  w.push({ t: 'cancel_timer', stageRunId: inst.id });
  if (!live) return;
  // An admitted launch nobody claimed yet has no executor to report back.
  if (!claimed) w.settleAttempt(inst, 'aborted');
  w.push({ t: 'abort', stageRunId: inst.id, attemptNo: inst.currentAttempt, reason });
}

function pauseInstance(w: Working, inst: InstanceState, statusReason: string, ttl = true): void {
  stopInstance(w, inst, 'paused', { statusReason }, 'pause');
  stageEvent(w, 'stage_run.paused', inst, { reason: statusReason });
  if (ttl && w.run.unattended) w.timer('pause_ttl', inst, PAUSE_TTL_MS, inst.version);
}

function cancelInstance(w: Working, inst: InstanceState, statusReason: string, skipReason: SkipReason | null = null): void {
  stopInstance(w, inst, 'cancelled', { statusReason, ...(skipReason ? { skipReason } : {}) }, skipReason === 'cancelled_loser' ? 'loser' : 'cancel');
  stageEvent(w, 'stage_run.cancelled', inst);
}

function failInstance(w: Working, inst: InstanceState, err: ClassifiedError, statusReason: string | null = null): void {
  w.transition(inst, 'failed', { statusReason, error: err.message, errorClass: err.class, errorCode: err.code });
  w.push({ t: 'cancel_timer', stageRunId: inst.id });
  stageEvent(w, 'stage_run.failed', inst, { error: err.message });
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

function pauseRun(w: Working, mode: 'drain' | 'interrupt', statusReason: string): void {
  w.runTransition('paused', { statusReason });
  for (const inst of w.sorted()) {
    // The run's own pause TTL covers these (PD-2).
    if (inst.status === 'ready' || inst.status === 'retry_wait') pauseInstance(w, inst, 'run_paused', false);
    else if (mode === 'interrupt' && inAttempt(inst.status)) pauseInstance(w, inst, 'run_paused', false);
  }
  w.emit('workflow_run.paused', { reason: statusReason });
  if (w.run.unattended) w.timer('pause_ttl', null, PAUSE_TTL_MS, w.run.version);
}

function resumeRun(w: Working): void {
  w.runTransition('running', { statusReason: null });
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

function cancelRun(w: Working, statusReason: string, outcome?: RunOutcome): void {
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

function onUsage(w: Working, msg: Extract<RunMessage, { type: 'usage_tick' }>): void {
  const inst = w.get(msg.stageRunId);
  if (!inst) return;
  w.usage(inst, msg.usage);
  const node = w.node(inst);
  if (!node || !inAttempt(inst.status) || msg.attemptNo !== inst.currentAttempt || inst.attemptStatus !== 'running') return;
  if (overBudget(inst.usage, node.budget)) {
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
        if (inst.status === 'paused') failInstance(w, inst, classified('pause_expired', 'Paused longer than the unattended pause limit'), 'pause_expired');
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
      if (!inst && (w.run.status === 'running' || w.run.status === 'waiting')) pauseRun(w, 'drain', 'budget_exhausted');
      return;
    default:
      return; // wait / loop timers arrive with their node kinds (P05)
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

function onCommand(w: Working, command: RunCommand): void {
  if (command.instanceId === undefined) {
    if (command.expectedVersion !== undefined && command.expectedVersion !== w.run.version) {
      return w.reject('version_conflict', `run version is ${w.run.version}, not ${command.expectedVersion}`);
    }
    switch (command.command) {
      case 'pause':
        if (!RUN_LIVE.includes(w.run.status)) return w.reject('invalid_state', `cannot pause a ${w.run.status} run`);
        return pauseRun(w, command.mode, `user:${command.mode}`);
      case 'resume':
        if (w.run.status !== 'paused') return w.reject('invalid_state', `cannot resume a ${w.run.status} run`);
        return resumeRun(w);
      case 'cancel':
        if (!['created', 'starting', 'running', 'waiting', 'paused', 'finalizing'].includes(w.run.status)) {
          return w.reject('invalid_state', `cannot cancel a ${w.run.status} run`);
        }
        return cancelRun(w, 'user_cancel');
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
    case 'retry':
      if (inst.status !== 'paused') return refuse();
      w.transition(inst, 'ready', { statusReason: `retry:${command.mode}` });
      w.push({ t: 'cancel_timer', kind: 'pause_ttl', stageRunId: inst.id });
      stageEvent(w, 'stage_run.retrying', inst, { retryCount: inst.failedAttempts });
      return;
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
    return;
  }
  if (w.run.status === 'cancelling') {
    w.runTransition('cancelled', msg.ok ? undefined : { error: msg.error ?? 'Compensation failed' });
    w.push({ t: 'cancel_timer' });
    w.emit('workflow_run.cancelled', {});
  }
}

// ── Settle: readiness, admission, run status ──────────────────────

function ensureRootInstances(w: Working): void {
  const rows: NewInstance[] = [];
  for (const key of w.graph.rootKeys) {
    if (w.rootByKey(key)) continue;
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

function resolveReadiness(w: Working): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const inst of w.roots()) {
      if (inst.status !== 'pending') continue;
      const node = w.node(inst);
      if (!node) continue;
      const preds: Array<{ instance: InstanceState; state: PredState; error?: string }> = [];
      for (const e of node.incoming) {
        const p = w.rootByKey(e.from);
        if (!p) continue;
        preds.push({ instance: p, ...predState(p, e, w.scopeFor) });
      }
      const r = readiness(node, preds);
      if (r.kind === 'blocked') continue;
      changed = true;
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
        const g = evalCondition(node.guard, w.scopeFor());
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
      w.transition(inst, 'ready', { statusReason: null });
      if (node.join.mode !== 'all' && node.join.cancelRemaining) {
        for (const key of exclusiveLosers(w, node)) {
          const loser = w.rootByKey(key);
          if (loser && !isTerminalStageRunState(loser.status)) cancelInstance(w, loser, 'cancelled_loser', 'cancelled_loser');
        }
      }
    }
  }
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
    if (!node) continue;
    if (node.sessionGroup && busyGroups.has(node.sessionGroup)) continue;
    const verdict = verdictOf(inst.interruptData);
    w.createAttempt(inst, attemptModeFor(inst), verdict ? { verdict } : undefined);
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
  resolveReadiness(w);

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
    pauseRun(w, 'drain', 'budget_exhausted');
    return;
  }

  admit(w);

  const busy = roots.some((i) => inAttempt(i.status) || i.status === 'ready');
  if (busy && w.run.status === 'waiting') w.runTransition('running');
  else if (!busy && w.run.status === 'running') w.runTransition('waiting');
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
    case 'command':
      onCommand(w, msg.command);
      break;
    case 'finalized':
      onFinalized(w, msg);
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
  for (const d of decisions) {
    switch (d.t) {
      case 'transition': {
        const i = instances.get(d.id);
        if (!i) break;
        i.status = d.to;
        i.version += 1;
        const p = d.patch;
        if (p) {
          if (p.statusReason !== undefined) i.statusReason = p.statusReason;
          if (p.skipReason !== undefined) i.skipReason = p.skipReason;
          if (p.skipCauseId !== undefined) i.skipCauseId = p.skipCauseId;
          if (p.gateAs !== undefined) i.gateAs = p.gateAs;
          if (p.outputData !== undefined || p.outputText !== undefined) i.output = p.outputData ?? p.outputText ?? null;
          if (p.summary !== undefined) i.summary = p.summary;
          if (p.interruptData !== undefined) i.interruptData = p.interruptData;
          if (p.errorCode !== undefined) i.errorCode = p.errorCode;
        }
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
            output: null, summary: null, interruptData: null, errorCode: null, usage: {}, leaseOwner: null, startedAt: null, completedAt: null,
          });
        }
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
        run.usage = addUsage(run.usage, d.usage);
        break;
      }
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
  return { run, instances: [...instances.values()] };
}

// ────────────────────────────────────────────────────────────────
// The working copy of a run state inside one decide() call, and the
// instance-level building blocks every handler shares (P03 WP-3.3; split
// out of decide.ts for the loop engine, P05 WP-5A.3). Every decision is
// also applied to the working copy, so later steps of the same call see
// earlier ones — the store applies the same list, in order, in one
// transaction.
// ────────────────────────────────────────────────────────────────

import { isTerminalStageRunState, type StageRunState, type WorkflowRunState } from '@generatorai/workflow-spec';
import type { ClassifiedError } from '../errors/StageError.js';
import type { CompiledNode, CompiledWorkflow } from '../workflow-graph/compile.js';
import { timerId } from './ids.js';
import { expressionScope } from './readiness.js';
import { StateIndex, expansionNodes, expansionStateOf, instanceScope, scopeIndexOf } from './scope.js';
import type {
  AttemptMode,
  AttemptStatus,
  Decision,
  InstancePatch,
  InstanceState,
  LoopIterationRecord,
  NewInstance,
  RunEventRecord,
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

export const inAttempt = (s: StageRunState) => ATTEMPT_STATES.includes(s);
export const byPath = (a: InstanceState, b: InstanceState) => (a.instancePath < b.instancePath ? -1 : a.instancePath > b.instancePath ? 1 : 0);

export function addUsage(a: Usage, b: Usage): Usage {
  const out: Usage = { ...a };
  for (const k of ['turns', 'costUsd', 'inputTokens', 'outputTokens'] as const) {
    if (b[k] !== undefined) out[k] = (out[k] ?? 0) + b[k]!;
  }
  return out;
}

export function overBudget(usage: Usage, budget: { maxTurns?: number; maxCostUsd?: number; maxTokens?: number } | undefined | null): boolean {
  if (!budget) return false;
  return (
    (budget.maxTurns !== undefined && (usage.turns ?? 0) >= budget.maxTurns) ||
    (budget.maxCostUsd !== undefined && (usage.costUsd ?? 0) >= budget.maxCostUsd) ||
    (budget.maxTokens !== undefined && (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) >= budget.maxTokens)
  );
}


export class Working {
  readonly decisions: Decision[] = [];
  readonly run: RunRecord;
  private readonly instances = new Map<string, InstanceState>();
  readonly iterations: LoopIterationRecord[];
  /** Delivered events nobody consumed yet, oldest first (event waits take them). */
  readonly events: RunEventRecord[];
  /** Who sent the event this batch's `deliver_event` delivered (a wait's `output.by`), by event and idempotency key. */
  readonly eventSenders = new Map<string, string>();
  rejected = false;
  /** The index over the working copy; rebuilt after any write. */
  private index: StateIndex | null = null;

  constructor(
    readonly graph: CompiledWorkflow,
    state: RunState,
    readonly now: number,
  ) {
    this.run = { ...state.run, usage: { ...state.run.usage } };
    for (const i of state.instances) this.instances.set(i.id, { ...i, usage: { ...i.usage } });
    this.iterations = [...(state.iterations ?? [])]; // a state built by hand (tests) may omit them
    this.events = [...(state.events ?? [])].sort((a, b) => a.receivedAt - b.receivedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

  /** The compiled node of an instance: the workflow's, or a planned stage's from its expansion's stored plan (P08 §8). */
  node(inst: InstanceState): CompiledNode | undefined {
    const base = this.graph.nodes.get(inst.stageKey);
    if (base || inst.scopeId === null) return base;
    const container = this.instances.get(inst.scopeId);
    const xs = container ? expansionStateOf(container) : null;
    return xs ? expansionNodes(xs).get(inst.stageKey) : undefined;
  }

  /** The index over the current working copy (P05 scopes). */
  ix(): StateIndex {
    this.index ??= new StateIndex(this.run, [...this.instances.values()], this.iterations);
    return this.index;
  }

  /**
   * What an edge `when` from `parent` reads (with `parent.status`), or,
   * without one, what a top-level guard reads.
   */
  scopeFor = (parent?: InstanceState): Record<string, unknown> =>
    parent ? instanceScope(this.ix(), parent, { parent }) : expressionScope(this.run, [...this.instances.values()]);

  /** What an instance's guard reads (context T of its enclosing loops). */
  guardScope(inst: InstanceState): Record<string, unknown> {
    return inst.scopeId === null ? this.scopeFor() : instanceScope(this.ix(), inst);
  }

  /** The instances of one scope, in path order. */
  scopeInstances(containerId: string | null, iteration: number | null): InstanceState[] {
    return this.ix().scope(containerId, iteration).sort(byPath);
  }

  /** The instance of a stage key in the same scope as `inst`. */
  sibling(inst: Pick<InstanceState, 'scopeId' | 'iterationIndex' | 'itemIndex'>, key: string): InstanceState | undefined {
    return this.ix()
      .scope(inst.scopeId, scopeIndexOf(inst))
      .find((i) => i.stageKey === key);
  }

  /** Every descendant of a container (any depth). */
  descendants(container: InstanceState): InstanceState[] {
    const out: InstanceState[] = [];
    const stack = [container.id];
    while (stack.length) {
      const id = stack.pop()!;
      for (const i of this.instances.values()) {
        if (i.scopeId === id) {
          out.push(i);
          stack.push(i.id);
        }
      }
    }
    return out.sort(byPath);
  }

  /** Enclosing containers, nearest first. */
  ancestors(inst: InstanceState): InstanceState[] {
    return this.ix()
      .chain(inst)
      .map((c) => c.container);
  }

  /** Has a live attempt: claimed (in an attempt state) or admitted and waiting to be claimed. */
  admitted(i: InstanceState): boolean {
    return i.attemptStatus === 'running' && (inAttempt(i.status) || i.status === 'ready');
  }

  // ── writes (decision + working copy) ──

  push(d: Decision): void {
    this.decisions.push(d);
    this.index = null;
  }

  /** Columns of an instance without a status change (a loop's state). */
  instancePatch(inst: InstanceState, patch: InstancePatch): void {
    this.push({ t: 'instance_patch', id: inst.id, status: inst.status, patch });
    inst.version += 1;
    applyPatch(inst, patch);
  }

  recordIteration(row: LoopIterationRecord): void {
    this.push({ t: 'record_iteration', row });
    this.iterations.push(row);
  }

  /** An event wait takes a delivered event: it leaves the pending list. */
  consumeEvent(event: RunEventRecord, inst: InstanceState): void {
    this.push({ t: 'consume_event', eventId: event.id, stageRunId: inst.id });
    const at = this.events.indexOf(event);
    if (at >= 0) this.events.splice(at, 1);
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
    if (patch) applyPatch(inst, patch);
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
    if (patch.budget !== undefined) this.run.budget = patch.budget;
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

  /** Usage of an instance, rolled up into the run and every enclosing container (a loop's budget, P05). */
  usage(inst: InstanceState, usage: Usage): void {
    this.push({ t: 'usage_rollup', stageRunId: inst.id, usage });
    inst.usage = addUsage(inst.usage, usage);
    this.run.usage = addUsage(this.run.usage, usage);
    for (const c of this.ancestors(inst)) {
      this.push({ t: 'usage_rollup', stageRunId: c.id, usage, scopeOnly: true });
      c.usage = addUsage(c.usage, usage);
    }
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

  addInstances(all: NewInstance[]): void {
    // An instance that exists already (a fork copied it into a scope it
    // re-seeds) is kept, as the store's ON CONFLICT DO NOTHING keeps its row.
    const rows = all.filter((r) => !this.instances.has(r.id));
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
        error: null,
        usage: {},
        leaseOwner: null,
        iterationIndex: r.iterationIndex ?? null,
        itemIndex: r.itemIndex ?? null,
        itemKey: r.itemKey ?? null,
        loopState: null,
        containerState: null,
        startedAt: null,
        completedAt: null,
      });
    }
  }
}

/** Apply a patch to an instance of a working copy (the store applies the same columns). */
export function applyPatch(inst: InstanceState, patch: InstancePatch): void {
  if (patch.statusReason !== undefined) inst.statusReason = patch.statusReason;
  if (patch.skipReason !== undefined) inst.skipReason = patch.skipReason;
  if (patch.skipCauseId !== undefined) inst.skipCauseId = patch.skipCauseId;
  if (patch.gateAs !== undefined) inst.gateAs = patch.gateAs;
  if (patch.outputData !== undefined || patch.outputText !== undefined) inst.output = patch.outputData ?? patch.outputText ?? null;
  if (patch.summary !== undefined) inst.summary = patch.summary;
  if (patch.interruptData !== undefined) inst.interruptData = patch.interruptData;
  if (patch.errorCode !== undefined) inst.errorCode = patch.errorCode;
  if (patch.error !== undefined) inst.error = patch.error;
  if (patch.loopState !== undefined) inst.loopState = patch.loopState;
  if (patch.containerState !== undefined) inst.containerState = patch.containerState;
}

// ── Instance-level building blocks ────────────────────────────────

/**
 * A `stage_run.*` event. It carries the instance's identity and its CAS
 * `version` after the batch's transition, so a client inserts an instance it
 * has not seen and drops a status older than the one it shows (D-21b).
 */
export function stageEvent(w: Working, kind: string, inst: InstanceState, data: Record<string, unknown> = {}): void {
  w.emit(kind, {
    stageRunId: inst.id,
    name: w.node(inst)?.name ?? inst.stageKey,
    stageKey: inst.stageKey,
    instancePath: inst.instancePath,
    version: inst.version,
    ...data,
  });
}

/** Stop an instance: its live attempt is aborted AFTER the desired state is written. */
export function stopInstance(w: Working, inst: InstanceState, to: 'paused' | 'cancelled' | 'skipped' | 'failed', patch: InstancePatch, reason: 'cancel' | 'pause' | 'loser' | 'queue_timeout'): void {
  // A frame may be running (an attempt state) or parked (awaiting_input); a
  // `ready` instance's attempt is only a queued launch.
  const live = inst.attemptStatus === 'running';
  const claimed = inst.status !== 'ready';
  w.transition(inst, to, patch);
  w.push({ t: 'cancel_timer', stageRunId: inst.id });
  stopContainer(w, inst);
  if (!live) return;
  // An admitted launch nobody claimed yet has no executor to report back.
  if (!claimed) w.settleAttempt(inst, 'aborted');
  w.push({ t: 'abort', stageRunId: inst.id, attemptNo: inst.currentAttempt, reason });
}

/**
 * A map or sub-workflow that stops (cancelled, failed, skipped) releases what
 * it holds outside the run: a map its worktree leases, a sub-workflow its
 * child run (cancelled with it; P05 §4.2).
 */
export function stopContainer(w: Working, inst: InstanceState): void {
  const cs = inst.containerState;
  if (!cs || !isTerminalStageRunState(inst.status)) return;
  if (cs.kind === 'map' && cs.phase !== 'done') {
    w.push({ t: 'map_release', stageRunId: inst.id });
    w.instancePatch(inst, { containerState: { ...cs, phase: 'done' } });
  } else if (cs.kind === 'subworkflow' && cs.phase !== 'done') {
    if (cs.childRunId) w.push({ t: 'child_command', stageRunId: inst.id, childRunId: cs.childRunId, command: 'cancel' });
    w.instancePatch(inst, { containerState: { ...cs, phase: 'done' } });
  } else if (cs.kind === 'expansion' && cs.phase !== 'done') {
    w.instancePatch(inst, { containerState: { ...cs, phase: 'done' } });
  }
}

export function pauseInstance(w: Working, inst: InstanceState, statusReason: string, ttl = true): void {
  stopInstance(w, inst, 'paused', { statusReason }, 'pause');
  stageEvent(w, 'stage_run.paused', inst, { reason: statusReason });
  if (ttl && w.run.unattended) w.timer('pause_ttl', inst, PAUSE_TTL_MS, inst.version);
}

export function cancelInstance(w: Working, inst: InstanceState, statusReason: string, skipReason: SkipReason | null = null): void {
  stopInstance(
    w,
    inst,
    'cancelled',
    { statusReason, ...(skipReason ? { skipReason } : {}), ...(inst.loopState ? { loopState: { ...inst.loopState, phase: 'done' as const } } : {}) },
    skipReason === 'cancelled_loser' ? 'loser' : 'cancel',
  );
  stageEvent(w, 'stage_run.cancelled', inst);
  // A container takes its body with it (P05).
  for (const d of w.descendants(inst)) {
    if (!isTerminalStageRunState(d.status)) {
      stopInstance(w, d, 'cancelled', { statusReason, ...(d.loopState ? { loopState: { ...d.loopState, phase: 'done' as const } } : {}) }, 'cancel');
      stageEvent(w, 'stage_run.cancelled', d);
    }
  }
}

export function failInstance(w: Working, inst: InstanceState, err: ClassifiedError, statusReason: string | null = null): void {
  w.transition(inst, 'failed', { statusReason, error: err.message, errorClass: err.class, errorCode: err.code });
  w.push({ t: 'cancel_timer', stageRunId: inst.id });
  stageEvent(w, 'stage_run.failed', inst, { error: err.message });
}


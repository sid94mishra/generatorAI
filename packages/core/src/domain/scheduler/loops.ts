// ────────────────────────────────────────────────────────────────
// The generic loop (P05 §2.3), inside the pure decide(). The engine knows
// only the `loop` kind: every scenario is a template graph of these
// settings (the presets of @generatorai/workflow-spec).
//
//   loop ready       carry(-1) := carryInit (context before iteration 0);
//                    capture the start tree hashes → create scope <loop>#0
//   scope k terminal phase settling; effect capture_iteration{k}
//   captured{k}      signals(k) from the attempts and the tree hashes;
//                    outcome(k): failed with only budget/wall-clock codes →
//                    EXHAUST(budget); failed + onBodyFailure fail → FAIL;
//                    carry(k) := every carry expression in C(k), all at once
//                    (an error keeps carry(k-1)[name]); exit rules in E(k)
//                    (an error or null is false), streaks, precedence
//                    fail > complete > pause > exhaust then order; row k is
//                    persisted with the next scope; then the fired action,
//                    else EXHAUST(max_iterations) at the cap, else
//                    EXHAUST(budget) when the budget is spent or projected
//                    to be, else scope k+1
//   EXHAUST(reason)  budget + wrapUp (once): a real wrap-up instance on its
//                    own allowance, then onLimit; else onLimit directly:
//                    pause (park) | fail | accept_last | accept_best (the
//                    best score, ties to the latest; all null → pause; an
//                    earlier iteration's checkpoint is restored first)
//
// Streaks count the trailing iterations a rule held since the loop start,
// the last operator command and the rule's last firing; an evaluation
// error or a failed iteration breaks every streak. Budgets: projection at
// the boundary (cost), a hard abort of the in-flight body at 1.25×, and a
// wall clock that excludes time parked for an operator.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { canonicalJson, evaluate, isTerminalStageRunState, MAX_LOOP_CARRY_BYTES, type RunCommand } from '@generatorai/workflow-spec';
import { classified } from '../errors/StageError.js';
import type { CompiledExpr, CompiledLoop, CompiledNode } from '../workflow-graph/compile.js';
import { instanceId } from './ids.js';
import { winnerPending } from './maps.js';
import { carryAt, isWrapUp, iterationStages, loopSettingsScope, WRAP_UP_SEGMENT, type CurrentIteration } from './scope.js';
import { computeScopeOutcome } from './terminal.js';
import type { InstanceState, LoopIterationRecord, LoopSignals, LoopState, RunOutcome, Usage } from './types.js';
import { failInstance, PAUSE_TTL_MS, stageEvent, stopInstance, type Working } from './working.js';

const ACTION_RANK: Record<string, number> = { fail: 0, complete: 1, pause: 2, exhaust: 3 };
/** Failure codes that mean "the loop ran out", not "the body broke" (P5-7). */
const LIMIT_CODES = new Set(['budget_exceeded', 'loop_wall_clock']);
const HARD_CAP = 1.25;

type LoopInstance = InstanceState & { loopState: LoopState };

function isLoop(i: InstanceState): i is LoopInstance {
  return i.loopState != null;
}

function loopEvent(w: Working, kind: string, inst: InstanceState, data: Record<string, unknown> = {}): void {
  w.emit(kind, { stageRunId: inst.id, stageKey: inst.stageKey, instancePath: inst.instancePath, version: inst.version, ...data });
}

type ExprValue = { ok: true; value: unknown } | { ok: false; message: string };

function evalExpr(expr: CompiledExpr, scope: Record<string, unknown>): ExprValue {
  if ('error' in expr) return { ok: false, message: `cannot parse "${expr.source}": ${expr.error}` };
  const r = evaluate(expr.ast, scope);
  return r.ok ? { ok: true, value: r.value } : { ok: false, message: `"${expr.source}": ${r.error.message}` };
}

function setState(w: Working, inst: LoopInstance, patch: Partial<LoopState>): LoopState {
  const next: LoopState = { ...inst.loopState, ...patch };
  w.instancePatch(inst, { loopState: next });
  return next;
}

// ── Budget ────────────────────────────────────────────────────────

export interface LoopLimits {
  maxTurns?: number;
  maxCostUsd?: number;
  maxTokens?: number;
  maxWallClockMs?: number;
}

export function loopLimits(node: CompiledNode, ls: LoopState): LoopLimits {
  const b = node.budget ?? {};
  const d = ls.budgetDelta;
  const add = (x: number | undefined, y: number | undefined) => (x === undefined ? undefined : x + (y ?? 0));
  const out: LoopLimits = {};
  const turns = add(b.maxTurns, d.maxTurns);
  const cost = add(b.maxCostUsd, d.maxCostUsd);
  const tokens = add(b.maxTokens, d.maxTokens);
  const wall = add(b.maxWallClockMs, d.maxWallClockMs);
  if (turns !== undefined) out.maxTurns = turns;
  if (cost !== undefined) out.maxCostUsd = cost;
  if (tokens !== undefined) out.maxTokens = tokens;
  if (wall !== undefined) out.maxWallClockMs = wall;
  return out;
}

const tokensOf = (u: Usage) => (u.inputTokens ?? 0) + (u.outputTokens ?? 0);

/** The active (not parked) time of the loop so far. */
function activeMs(w: Working, ls: LoopState): number {
  return w.now - ls.startedAt - ls.parkedMs - (ls.parkedSince !== null ? w.now - ls.parkedSince : 0);
}

function spent(w: Working, inst: LoopInstance, limits: LoopLimits, factor = 1): boolean {
  const u = inst.usage;
  return (
    (limits.maxTurns !== undefined && (u.turns ?? 0) >= limits.maxTurns * factor) ||
    (limits.maxCostUsd !== undefined && (u.costUsd ?? 0) >= limits.maxCostUsd * factor) ||
    (limits.maxTokens !== undefined && tokensOf(u) >= limits.maxTokens * factor) ||
    (factor === 1 && limits.maxWallClockMs !== undefined && activeMs(w, inst.loopState) >= limits.maxWallClockMs)
  );
}

/** At an iteration boundary: spent, or another iteration of average cost would overrun the cost budget. */
function budgetOut(w: Working, inst: LoopInstance, node: CompiledNode): boolean {
  const limits = loopLimits(node, inst.loopState);
  if (spent(w, inst, limits)) return true;
  if (limits.maxCostUsd === undefined) return false;
  const rows = w.iterations.filter((r) => r.stageRunId === inst.id);
  if (rows.length === 0) return false;
  const avg = (inst.usage.costUsd ?? 0) / rows.length;
  return (inst.usage.costUsd ?? 0) + avg > limits.maxCostUsd;
}

/** The wrap-up instance's own allowance: its turns, and its share of the cost budget. */
export function wrapUpAllowance(loop: CompiledLoop, node: CompiledNode, ls: LoopState): { maxTurns: number; maxCostUsd?: number } {
  const cost = loopLimits(node, ls).maxCostUsd;
  return { maxTurns: loop.wrapUp?.maxTurns ?? 1, ...(cost !== undefined ? { maxCostUsd: cost * (loop.wrapUp?.maxCostShare ?? 0.1) } : {}) };
}

// ── Scopes ────────────────────────────────────────────────────────

function lastK(w: Working, inst: InstanceState): number {
  const rows = w.iterations.filter((r) => r.stageRunId === inst.id);
  return rows.length === 0 ? -1 : Math.max(...rows.map((r) => r.k));
}

function rowOf(w: Working, inst: InstanceState, k: number): LoopIterationRecord | undefined {
  return w.iterations.find((r) => r.stageRunId === inst.id && r.k === k);
}

function createScope(w: Working, inst: LoopInstance, node: CompiledNode, k: number): void {
  w.addInstances(
    node.body.map((key) => {
      const body = w.graph.nodes.get(key)!;
      const path = `${inst.instancePath}#${k}/${key}`;
      return { id: instanceId(w.run.id, path), stageKey: key, kind: body.kind, name: body.name, instancePath: path, scopeId: inst.id, iterationIndex: k };
    }),
  );
  loopEvent(w, 'loop.iteration_started', inst, { k, maxIterations: inst.loopState.effectiveMax });
}

/** Arm the loop's wall-clock timer for what remains of it (parked time excluded). */
function armWallClock(w: Working, inst: LoopInstance, node: CompiledNode): void {
  const limit = loopLimits(node, inst.loopState).maxWallClockMs;
  if (limit === undefined) return;
  w.timer('loop_wall_clock', inst, Math.max(0, limit - activeMs(w, inst.loopState)), inst.version, { jitter: 'none' });
}

/** A ready loop: carry(-1), then the start tree hashes. */
export function startLoop(w: Working, inst: InstanceState, node: CompiledNode): void {
  const loop = node.loop!;
  const ls: LoopState = {
    k: 0,
    phase: 'starting',
    effectiveMax: loop.maxIterations,
    budgetDelta: {},
    streaks: loop.exits.map(() => 0),
    exitReason: null,
    exitAction: null,
    carryInit: {},
    operatorInput: null,
    startedAt: w.now,
    parkedMs: 0,
    parkedSince: null,
    startHashes: null,
    wrappedUp: false,
    pending: null,
  };
  w.transition(inst, 'running', { statusReason: null, loopState: ls });
  const running = inst as LoopInstance;
  const initScope = loopSettingsScope(w.ix(), running, 'init', 0);
  const carryInit: Record<string, unknown> = {};
  for (const [name, expr] of loop.carryInit) {
    const r = evalExpr(expr, initScope);
    if (r.ok) carryInit[name] = r.value;
    else {
      carryInit[name] = null;
      loopEvent(w, 'loop.carry_error', inst, { k: -1, name, error: r.message });
    }
  }
  setState(w, running, { carryInit });
  stageEvent(w, 'stage_run.running', inst, { kind: 'loop' });
  armWallClock(w, running, node);
  w.push({ t: 'capture_iteration', stageRunId: inst.id, k: 0, at: 'start', checkpoint: false });
}

/** Scope k of a running loop is terminal: capture the iteration's end. */
function settleIteration(w: Working, inst: LoopInstance, node: CompiledNode): void {
  const ls = inst.loopState;
  setState(w, inst, { phase: 'settling' });
  w.push({ t: 'capture_iteration', stageRunId: inst.id, k: ls.k, at: 'end', checkpoint: node.loop!.checkpointEachIteration });
}

// ── Signals ───────────────────────────────────────────────────────

/** Canonical JSON (sorted keys) of an output, without its timing fields (P5-36). */
export function outputHash(output: unknown): string | null {
  if (output === null || output === undefined) return null;
  const strip = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = { ...(v as Record<string, unknown>) };
    delete o['durationMs'];
    delete o['timedOut'];
    return o;
  };
  return createHash('sha256').update(canonicalJson(strip(output))).digest('hex').slice(0, 16);
}

function computeSignals(w: Working, inst: LoopInstance, k: number, hashes: Record<string, string | null> | null): LoopSignals {
  const stages: LoopSignals['stages'] = {};
  let total: number | null = 0;
  for (const i of w.scopeInstances(inst.id, k)) {
    const node = w.graph.nodes.get(i.stageKey);
    // Only agents make tool calls; a stage that never ran has none.
    const calls = node?.kind === 'agent' ? (i.startedAt !== null ? (i.usage.toolCalls ?? 0) : 0) : null;
    stages[i.stageKey] = { toolCalls: calls, outputHash: outputHash(i.output), status: i.status };
    if (calls !== null && total !== null) total += calls;
  }
  const prev = k === 0 ? inst.loopState.startHashes : (rowOf(w, inst, k - 1)?.signals?.treeHashes ?? null);
  let workspaceChanged: boolean | null = null;
  if (hashes && prev) {
    const mounts = new Set([...Object.keys(hashes), ...Object.keys(prev)]);
    let unknown = false;
    let changed = false;
    for (const m of mounts) {
      const a = hashes[m] ?? null;
      const b = prev[m] ?? null;
      if (a === null || b === null) unknown = true;
      else if (a !== b) changed = true;
    }
    workspaceChanged = changed ? true : unknown ? null : false;
  }
  return { toolCalls: total, workspaceChanged, treeHashes: hashes, stages };
}

// ── The iteration's end ───────────────────────────────────────────

export function onIterationCaptured(w: Working, msg: { stageRunId: string; k: number; at: 'start' | 'end'; treeHashes: Record<string, string | null> | null; checkpointTurnId?: string | null }): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || !isLoop(inst) || inst.status !== 'running') return;
  const node = w.node(inst);
  if (!node?.loop) return;
  const ls = inst.loopState;
  if (msg.at === 'start') {
    if (ls.phase !== 'starting' || msg.k !== 0) return;
    setState(w, inst, { phase: 'running', startHashes: msg.treeHashes });
    createScope(w, inst, node, 0);
    return;
  }
  if (ls.phase !== 'settling' || msg.k !== ls.k) return; // stale or duplicate
  finishIteration(w, inst, node, msg.treeHashes, msg.checkpointTurnId ?? null);
}

function finishIteration(w: Working, inst: LoopInstance, node: CompiledNode, hashes: Record<string, string | null> | null, checkpointTurnId: string | null): void {
  const loop = node.loop!;
  const k = inst.loopState.k;
  const ix = w.ix();
  const scope = w.scopeInstances(inst.id, k);
  const signals = computeSignals(w, inst, k, hashes);
  const outcome: RunOutcome = computeScopeOutcome(w.graph, scope, w.scopeFor);
  const usage = scope.reduce<Usage>((acc, i) => {
    const out: Usage = { ...acc };
    for (const key of ['turns', 'costUsd', 'inputTokens', 'outputTokens', 'toolCalls'] as const) {
      if (i.usage[key] !== undefined) out[key] = (out[key] ?? 0) + i.usage[key]!;
    }
    return out;
  }, {});
  const startedAt = scope.reduce<number | null>((m, i) => (i.startedAt !== null && (m === null || i.startedAt < m) ? i.startedAt : m), null);
  const prevCarry = carryAt(ix, inst, k - 1) ?? {};
  const baseRow = (patch: Partial<LoopIterationRecord>): LoopIterationRecord => ({
    stageRunId: inst.id,
    k,
    carry: prevCarry,
    exitValues: {},
    streaks: inst.loopState.streaks.map(() => 0),
    signals,
    score: null,
    checkpointTurnId,
    usage,
    outcome,
    startedAt,
    endedAt: w.now,
    ...patch,
  });

  if (outcome !== 'completed') {
    const broken = scope.filter((i) => i.status !== 'completed' && i.status !== 'skipped');
    if (broken.length > 0 && broken.every((i) => i.errorCode !== null && LIMIT_CODES.has(i.errorCode))) {
      w.recordIteration(baseRow({}));
      loopEvent(w, 'loop.iteration_completed', inst, { k, outcome, signals });
      return exhaust(w, inst, node, 'budget');
    }
    if (loop.onBodyFailure === 'fail') {
      w.recordIteration(baseRow({}));
      loopEvent(w, 'loop.iteration_completed', inst, { k, outcome, signals });
      const first = broken[0];
      return failLoop(w, inst, 'loop_body_failed', 'body_failed', `Iteration ${k} failed${first ? ` at '${first.stageKey}'` : ''}${first?.error ? `: ${first.error}` : ''}`);
    }
  }

  // carry(k): every expression reads carry(k-1) (simultaneous); an error keeps the old value.
  const cScope = loopSettingsScope(ix, inst, 'C', k, { signals });
  const carry: Record<string, unknown> = { ...prevCarry };
  for (const [name, expr] of loop.carry) {
    const r = evalExpr(expr, cScope);
    if (r.ok) carry[name] = r.value;
    else loopEvent(w, 'loop.carry_error', inst, { k, name, error: r.message });
  }
  if (Buffer.byteLength(JSON.stringify(carry), 'utf8') > MAX_LOOP_CARRY_BYTES) {
    w.recordIteration(baseRow({}));
    return failLoop(w, inst, 'loop_carry_too_large', 'carry_too_large', `The carried state of iteration ${k} is over ${MAX_LOOP_CARRY_BYTES} bytes`);
  }

  // Exit rules in E(k).
  const current: CurrentIteration = { carry, signals };
  const eScope = loopSettingsScope(ix, inst, 'E', k, current);
  let broken = outcome !== 'completed';
  const values: boolean[] = [];
  const exitValues: Record<string, boolean | null> = {};
  loop.exits.forEach((rule, n) => {
    const r = evalExpr(rule.when, eScope);
    if (!r.ok) {
      broken = true;
      loopEvent(w, 'loop.exit_error', inst, { k, rule: n, reason: rule.reason, error: r.message });
    }
    const v = r.ok && r.value === true;
    values.push(v);
    const label = exitValues[rule.reason] === undefined ? rule.reason : `${rule.reason}#${n}`;
    exitValues[label] = r.ok ? (r.value === null ? null : v) : null;
  });
  const streaks = loop.exits.map((_, n) => (values[n] ? (broken ? 1 : (inst.loopState.streaks[n] ?? 0) + 1) : 0));
  const fired = loop.exits
    .map((rule, n) => ({ rule, n }))
    .filter(({ rule, n }) => streaks[n]! >= rule.consecutive)
    .sort((a, b) => ACTION_RANK[a.rule.action]! - ACTION_RANK[b.rule.action]! || a.n - b.n)[0];
  if (fired) streaks[fired.n] = 0; // a streak counts from the rule's last firing

  let score: number | null = null;
  if (loop.onLimit.mode === 'accept_best') {
    const r = evalExpr(loop.onLimit.score, eScope);
    score = r.ok && typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null;
  }

  w.recordIteration(baseRow({ carry, exitValues, streaks, score }));
  setState(w, inst, { streaks });
  loopEvent(w, 'loop.iteration_completed', inst, { k, outcome, exitValues, streaks, score, signals, usage });

  if (fired) {
    loopEvent(w, 'loop.exit', inst, { k, action: fired.rule.action, reason: fired.rule.reason });
    switch (fired.rule.action) {
      case 'complete':
        return completeLoop(w, inst, node, k, 'complete', fired.rule.reason);
      case 'fail':
        return failLoop(w, inst, 'loop_exit_fail', fired.rule.reason, `The loop's rule '${fired.rule.reason}' failed it at iteration ${k}`);
      case 'pause':
        return park(w, inst, node, 'pause', fired.rule.reason);
      case 'exhaust':
        return exhaust(w, inst, node, fired.rule.reason);
    }
  }
  if (k + 1 >= inst.loopState.effectiveMax) return exhaust(w, inst, node, 'max_iterations');
  if (budgetOut(w, inst, node)) return exhaust(w, inst, node, 'budget');
  nextIteration(w, inst, node, k + 1);
}

function nextIteration(w: Working, inst: LoopInstance, node: CompiledNode, k: number): void {
  setState(w, inst, { k, phase: 'running' });
  createScope(w, inst, node, k);
}

// ── Exhaustion, parking, completion ───────────────────────────────

function exhaust(w: Working, inst: LoopInstance, node: CompiledNode, reason: string): void {
  const loop = node.loop!;
  if (reason === 'budget' && loop.wrapUp && !inst.loopState.wrappedUp) {
    const body = w.graph.nodes.get(loop.wrapUp.stage);
    if (body) {
      const path = `${inst.instancePath}${WRAP_UP_SEGMENT}${loop.wrapUp.stage}`;
      const id = instanceId(w.run.id, path);
      setState(w, inst, { phase: 'wrapping_up', wrappedUp: true, pending: { kind: 'limit', reason } });
      w.addInstances([{ id, stageKey: body.key, kind: body.kind, name: `${body.name} (wrap-up)`, instancePath: path, scopeId: inst.id }]);
      const wrap = w.get(id)!;
      w.transition(wrap, 'ready', { statusReason: 'wrap_up' });
      loopEvent(w, 'loop.wrap_up', inst, { stageKey: body.key, wrapUpId: id });
      return;
    }
  }
  applyLimit(w, inst, node, reason);
}

function applyLimit(w: Working, inst: LoopInstance, node: CompiledNode, reason: string): void {
  const loop = node.loop!;
  const last = lastK(w, inst);
  switch (loop.onLimit.mode) {
    case 'fail':
      return failLoop(w, inst, 'loop_limit', reason, `The loop ran out (${reason}) and its onLimit is fail`);
    case 'accept_last':
      if (last < 0) return failLoop(w, inst, 'loop_limit', reason, `The loop ran out (${reason}) before any iteration finished`);
      return completeLoop(w, inst, node, last, 'accept_last', reason);
    case 'accept_best': {
      const scored = w.iterations.filter((r) => r.stageRunId === inst.id && r.score !== null);
      if (scored.length === 0) return park(w, inst, node, 'exhaust', reason); // all null behaves as pause
      const best = scored.reduce((a, b) => (b.score! >= a.score! ? b : a)); // ties go to the latest
      return acceptIteration(w, inst, node, best.k, 'accept_best', reason);
    }
    default:
      return park(w, inst, node, 'exhaust', reason);
  }
}

/** Complete with iteration k: directly when it is the last one, else after restoring its checkpoint. */
function acceptIteration(w: Working, inst: LoopInstance, node: CompiledNode, k: number, action: string, reason: string): void {
  if (k === lastK(w, inst)) return completeLoop(w, inst, node, k, action, reason);
  const row = rowOf(w, inst, k);
  if (!row?.checkpointTurnId) {
    return failLoop(w, inst, 'restore_failed', reason, `Iteration ${k} has no workspace checkpoint to restore`);
  }
  setState(w, inst, { phase: 'restoring', pending: { kind: 'accept', k, action, reason } });
  w.push({ t: 'restore_iteration', stageRunId: inst.id, k, checkpointTurnId: row.checkpointTurnId });
}

export function onIterationRestored(w: Working, msg: { stageRunId: string; k: number; ok: boolean; error?: string }): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || !isLoop(inst) || inst.loopState.phase !== 'restoring') return;
  const pending = inst.loopState.pending;
  if (!pending || pending.kind !== 'accept' || pending.k !== msg.k) return;
  const node = w.node(inst);
  if (!node?.loop) return;
  if (!msg.ok) return failLoop(w, inst, 'restore_failed', pending.reason, `Restoring iteration ${msg.k} failed: ${msg.error ?? 'unknown error'}`);
  completeLoop(w, inst, node, pending.k, pending.action, pending.reason);
}

function park(w: Working, inst: LoopInstance, node: CompiledNode, action: 'pause' | 'exhaust', reason: string): void {
  const last = lastK(w, inst);
  const rows = w.iterations.filter((r) => r.stageRunId === inst.id);
  w.transition(inst, 'awaiting_input', {
    statusReason: `loop_${action}:${reason}`,
    loopState: { ...inst.loopState, phase: 'parked', parkedSince: w.now, exitReason: reason, exitAction: action, pending: null },
    interruptData: {
      kind: 'loop_decision',
      action,
      reason,
      k: last,
      iterations: rows.length,
      maxIterations: inst.loopState.effectiveMax,
      usage: inst.usage,
      budget: loopLimits(node, inst.loopState),
      checkpoints: rows.filter((r) => r.checkpointTurnId !== null).map((r) => r.k),
      scores: rows.map((r) => ({ k: r.k, score: r.score })),
    },
  });
  w.push({ t: 'cancel_timer', kind: 'loop_wall_clock', stageRunId: inst.id });
  if (w.run.unattended) w.timer('pause_ttl', inst, PAUSE_TTL_MS, inst.version);
  loopEvent(w, 'loop.parked', inst, { action, reason, k: last });
  stageEvent(w, 'stage_run.awaiting_input', inst, { interruptData: inst.interruptData });
}

/** The loop output (P05 §2.4): `last` is the chosen iteration's body outputs. */
function loopOutput(w: Working, inst: LoopInstance, node: CompiledNode, k: number, action: string, reason: string): Record<string, unknown> {
  const loop = node.loop!;
  const ix = w.ix();
  const rows = w.iterations.filter((r) => r.stageRunId === inst.id).sort((a, b) => a.k - b.k);
  const row = rowOf(w, inst, k);
  const last: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(iterationStages(ix, inst, k))) last[key] = (v as { output: unknown }).output ?? null;
  const wrap = w.descendants(inst).find((i) => i.scopeId === inst.id && isWrapUp(i));
  const out: Record<string, unknown> = {
    iterations: rows.length,
    exitReason: reason,
    exitAction: action,
    last,
    wrapUp: wrap && wrap.status === 'completed' ? { text: typeof wrap.output === 'string' ? wrap.output : JSON.stringify(wrap.output) } : null,
    carry: row?.carry ?? carryAt(ix, inst, k) ?? {},
    history: rows.map((r) => ({ k: r.k, exitValues: r.exitValues, ...(r.score !== null ? { score: r.score } : {}), usage: r.usage })),
  };
  if (loop.select.length > 0 && k >= 0) {
    const scope = loopSettingsScope(ix, inst, 'E', k, { ...(row ? { carry: row.carry, signals: row.signals } : {}) });
    for (const [name, expr] of loop.select) {
      if (name in out) continue;
      const r = evalExpr(expr, scope);
      out[name] = r.ok ? r.value : null;
    }
  }
  return out;
}

function completeLoop(w: Working, inst: LoopInstance, node: CompiledNode, k: number, action: string, reason: string): void {
  const output = loopOutput(w, inst, node, k, action, reason);
  w.transition(inst, 'completed', {
    statusReason: `loop:${reason}`,
    outputData: output,
    summary: `Loop '${node.name}' ${action === 'complete' ? 'completed' : `accepted (${action})`}: ${reason}, iteration ${k + 1} of ${output['iterations']}`,
    loopState: { ...inst.loopState, phase: 'done', exitReason: reason, exitAction: action, parkedSince: null, pending: null },
    error: null,
    errorClass: null,
    errorCode: null,
  });
  w.push({ t: 'cancel_timer', stageRunId: inst.id });
  stageEvent(w, 'stage_run.completed', inst, { exitReason: reason, exitAction: action });
}

function failLoop(w: Working, inst: LoopInstance, code: string, reason: string, message: string): void {
  // Nothing of the loop keeps running once it fails.
  for (const d of w.descendants(inst)) {
    if (!isTerminalStageRunState(d.status)) stopInstance(w, d, 'cancelled', { statusReason: 'loop_ended' }, 'cancel');
  }
  const err = classified(code as 'loop_limit', message);
  const ls = { ...inst.loopState, phase: 'done' as const, exitReason: reason, exitAction: 'fail', parkedSince: null, pending: null };
  failInstance(w, inst, err, `loop:${reason}`);
  w.instancePatch(inst, { loopState: ls });
}

// ── Mid-iteration budget: the hard cap and the wall clock ─────────

/** Stop the in-flight scope of a loop: every live instance fails with `code`, pending ones are skipped. */
function abortScope(w: Working, inst: LoopInstance, code: 'budget_exceeded' | 'loop_wall_clock', message: string): void {
  const err = classified(code, message);
  for (const i of w.descendants(inst)) {
    if (isTerminalStageRunState(i.status)) continue;
    if (i.status === 'pending') {
      w.transition(i, 'skipped', { skipReason: 'scope_aborted', skipCauseId: inst.id, statusReason: code, errorCode: code });
      continue;
    }
    const to = i.status === 'retry_wait' ? 'cancelled' : 'failed';
    if (i.attemptStatus === 'running' && i.status !== 'ready') w.settleAttempt(i, 'failed', err);
    stopInstance(w, i, to, { statusReason: code, error: message, errorClass: err.class, errorCode: code }, 'cancel');
    stageEvent(w, to === 'failed' ? 'stage_run.failed' : 'stage_run.cancelled', i, { error: message });
  }
}

/** After usage reached a body instance: the hard cap (1.25×) of every enclosing loop. */
export function enforceLoopBudgets(w: Working, inst: InstanceState): void {
  for (const c of w.ancestors(inst)) {
    if (!isLoop(c) || c.status !== 'running' || c.loopState.phase !== 'running') continue;
    const node = w.node(c);
    if (!node?.loop) continue;
    // The wall clock has its own timer; the hard cap is about spend.
    const spend = { ...loopLimits(node, c.loopState) };
    delete spend.maxWallClockMs;
    if (spent(w, c, spend, HARD_CAP)) abortScope(w, c, 'budget_exceeded', `The loop '${node.name}' is over 1.25× its budget`);
  }
}

export function onLoopWallClock(w: Working, inst: InstanceState): void {
  if (!isLoop(inst) || inst.status !== 'running' || inst.loopState.phase !== 'running') return;
  const node = w.node(inst);
  abortScope(w, inst, 'loop_wall_clock', `The loop '${node?.name ?? inst.stageKey}' ran out of wall-clock time`);
}

// ── Settle: containers ────────────────────────────────────────────

/** The loops that can move without a message: ready ones start, finished scopes settle, a finished wrap-up applies the limit. Returns whether anything changed. */
export function settleLoops(w: Working): boolean {
  let changed = false;
  for (const inst of w.sorted()) {
    const node = w.node(inst);
    if (!node?.loop) continue;
    if (inst.status === 'ready' && inst.loopState == null) {
      startLoop(w, inst, node);
      changed = true;
      continue;
    }
    if (!isLoop(inst) || inst.status !== 'running') continue;
    const ls = inst.loopState;
    if (ls.phase === 'running') {
      const scope = w.scopeInstances(inst.id, ls.k);
      if (scope.length > 0 && scope.every((i) => isTerminalStageRunState(i.status)) && !winnerPending(scope)) {
        settleIteration(w, inst, node);
        changed = true;
      }
    } else if (ls.phase === 'wrapping_up') {
      const wrap = w.descendants(inst).find((i) => i.scopeId === inst.id && isWrapUp(i));
      if (!wrap || isTerminalStageRunState(wrap.status)) {
        const reason = ls.pending?.kind === 'limit' ? ls.pending.reason : 'budget';
        setState(w, inst, { phase: 'running', pending: null });
        applyLimit(w, inst, node, reason);
        changed = true;
      }
    }
  }
  return changed;
}

/** The active scopes readiness runs in: the top level and the current iteration of every running loop. */
export function activeScopes(w: Working): Array<{ containerId: string | null; iteration: number | null }> {
  const out: Array<{ containerId: string | null; iteration: number | null }> = [{ containerId: null, iteration: null }];
  for (const i of w.sorted()) {
    if (isLoop(i) && i.status === 'running' && i.loopState.phase === 'running') out.push({ containerId: i.id, iteration: i.loopState.k });
  }
  return out;
}

// ── Operator commands on a loop ───────────────────────────────────

const LOOP_COMMANDS = new Set(['grant_iterations', 'raise_budget', 'continue_with_input', 'accept', 'accept_iteration', 'fail']);

export function isLoopCommand(command: RunCommand['command']): boolean {
  return LOOP_COMMANDS.has(command);
}

/**
 * Apply an operator decision to a loop (P05 §2.3). Every command resets the
 * streaks. Returns a refusal message, or null when applied.
 */
export function loopCommand(w: Working, inst: InstanceState, command: RunCommand): string | null {
  const node = w.node(inst);
  if (!node?.loop || !isLoop(inst)) return `'${inst.stageKey}' is not a loop`;
  const ls = inst.loopState;
  const parked = inst.status === 'awaiting_input' && ls.phase === 'parked';
  const live = inst.status === 'running' || parked;
  const zero = ls.streaks.map(() => 0);
  const applied = (data: Record<string, unknown>) => loopEvent(w, 'loop.command_applied', inst, { command: command.command, ...data });

  switch (command.command) {
    case 'grant_iterations': {
      if (!live) return `cannot grant iterations to a ${inst.status} loop`;
      setState(w, inst, { effectiveMax: ls.effectiveMax + command.n, streaks: zero });
      applied({ n: command.n, maxIterations: inst.loopState.effectiveMax });
      if (parked) tryContinue(w, inst, node);
      return null;
    }
    case 'raise_budget': {
      if (!live) return `cannot raise the budget of a ${inst.status} loop`;
      const d = { ...ls.budgetDelta };
      for (const k of ['maxTurns', 'maxCostUsd', 'maxTokens', 'maxWallClockMs'] as const) {
        if (command[k] !== undefined) d[k] = (d[k] ?? 0) + command[k]!;
      }
      setState(w, inst, { budgetDelta: d, streaks: zero });
      applied({ budget: loopLimits(node, inst.loopState) });
      if (parked) tryContinue(w, inst, node);
      else if (command.maxWallClockMs !== undefined) armWallClock(w, inst, node);
      return null;
    }
    case 'continue_with_input': {
      if (!live) return `cannot continue a ${inst.status} loop`;
      const nextK = parked ? ls.k + 1 : ls.k + 1;
      setState(w, inst, {
        operatorInput: { text: command.text, forIteration: nextK },
        streaks: zero,
        // Continuing means one more iteration, whatever the cap.
        effectiveMax: parked ? Math.max(ls.effectiveMax, nextK + 1) : ls.effectiveMax,
      });
      applied({ forIteration: nextK });
      if (parked) tryContinue(w, inst, node);
      return null;
    }
    case 'accept': {
      if (!parked) return `only a parked loop can be accepted (it is ${inst.status})`;
      const last = lastK(w, inst);
      if (last < 0) return 'no iteration has finished yet';
      setState(w, inst, { streaks: zero });
      applied({ k: last });
      completeLoop(w, inst, node, last, 'accept', 'accepted');
      return null;
    }
    case 'accept_iteration': {
      if (!parked) return `only a parked loop can accept an iteration (it is ${inst.status})`;
      const row = rowOf(w, inst, command.k);
      if (!row) return `iteration ${command.k} has not finished`;
      if (command.k !== lastK(w, inst) && !row.checkpointTurnId) {
        return `checkpoint_unavailable: iteration ${command.k} has no workspace checkpoint (turn on checkpointEachIteration)`;
      }
      setState(w, inst, { streaks: zero });
      applied({ k: command.k });
      // Out of the parked state first: the restore (if any) runs from `running`.
      w.transition(inst, 'running', { statusReason: null, interruptData: null });
      setState(w, inst, { phase: 'running', parkedMs: ls.parkedMs + (ls.parkedSince !== null ? w.now - ls.parkedSince : 0), parkedSince: null });
      acceptIteration(w, inst, node, command.k, 'accept_iteration', `accepted_${command.k}`);
      return null;
    }
    case 'fail': {
      if (!parked) return `only a parked loop can be failed (it is ${inst.status})`;
      applied({});
      failLoop(w, inst, 'config_invalid', 'operator', 'Failed by an operator');
      return null;
    }
    default:
      return `${command.command} does not apply to a loop`;
  }
}

/** A parked loop continues with its next iteration when its cap and budget allow; else it stays parked. */
function tryContinue(w: Working, inst: LoopInstance, node: CompiledNode): void {
  const ls = inst.loopState;
  const next = lastK(w, inst) + 1;
  if (next >= ls.effectiveMax) return; // still at the cap: the card stays
  const parkedMs = ls.parkedMs + (ls.parkedSince !== null ? w.now - ls.parkedSince : 0);
  const resumed = { ...ls, parkedMs, parkedSince: null };
  // Judge the budget as it will be once running again.
  const probe = { ...inst, loopState: resumed } as LoopInstance;
  if (budgetOut(w, probe, node)) return;
  w.transition(inst, 'running', {
    statusReason: null,
    interruptData: null,
    loopState: { ...resumed, k: next, phase: 'running', exitReason: null, exitAction: null },
  });
  w.push({ t: 'cancel_timer', kind: 'pause_ttl', stageRunId: inst.id });
  armWallClock(w, inst as LoopInstance, node);
  stageEvent(w, 'stage_run.resumed', inst);
  createScope(w, inst as LoopInstance, node, next);
}

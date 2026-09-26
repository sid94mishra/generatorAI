// ────────────────────────────────────────────────────────────────
// Expression scopes of the scheduler and the executor (P05 §2.2). Pure.
//
// A place inside a loop body reads the `loop` root in one of three
// contexts of its loop, for iteration k:
//
//   context  used by                              last   previous  carry      priorCarry
//   T(k)     prompts, follow-ups, guards, check   k-1    k-1       carry(k-1) carry(k-2)
//            env, edge `when` of the body
//   C(k)     the `carry` expressions              k      k-1       carry(k-1) carry(k-2)
//   E(k)     exits, onLimit.score, output.select  k      k-1       carry(k)   carry(k-1)
//
// carry(-1) is the carryInit values (a carry without one is null); a path
// before the first iteration (`loop.previous` in iteration 0) is null.
// `stages.<key>` sees the top-level stages and, inside a body, the
// instances of the SAME iteration of every enclosing loop. `loops.<key>`
// is every enclosing loop.
// ────────────────────────────────────────────────────────────────

import type { CompiledWorkflow } from '../workflow-graph/compile.js';
import type { InstanceState, LoopIterationRecord, LoopSignals, RunRecord, RunState, Usage } from './types.js';

/** The marker of a loop's wrap-up instance in its path: `<loop>#wrapup/<stage>`. */
export const WRAP_UP_SEGMENT = '#wrapup/';

export function isWrapUp(inst: Pick<InstanceState, 'instancePath'>): boolean {
  return inst.instancePath.includes(WRAP_UP_SEGMENT);
}

export type LoopContext = 'T' | 'C' | 'E';

/** Indexes over a run state, for building scopes repeatedly. */
export class StateIndex {
  readonly byId = new Map<string, InstanceState>();
  /** Instances by container id, then iteration (null: the container's non-iteration instances, e.g. a wrap-up). */
  private readonly byScope = new Map<string, InstanceState[]>();
  private readonly rowsByLoop = new Map<string, LoopIterationRecord[]>();

  constructor(
    readonly run: RunRecord,
    instances: readonly InstanceState[],
    iterations: readonly LoopIterationRecord[],
  ) {
    for (const i of instances) {
      this.byId.set(i.id, i);
      const key = scopeKey(i.scopeId, i.iterationIndex);
      const list = this.byScope.get(key) ?? [];
      list.push(i);
      this.byScope.set(key, list);
    }
    for (const r of iterations) {
      const list = this.rowsByLoop.get(r.stageRunId) ?? [];
      list.push(r);
      this.rowsByLoop.set(r.stageRunId, list);
    }
    for (const list of this.rowsByLoop.values()) list.sort((a, b) => a.k - b.k);
  }

  /** The instances of one scope: the top level (`null`), or one iteration of a container. */
  scope(containerId: string | null, iteration: number | null): InstanceState[] {
    return this.byScope.get(scopeKey(containerId, iteration)) ?? [];
  }

  rows(loopId: string): LoopIterationRecord[] {
    return this.rowsByLoop.get(loopId) ?? [];
  }

  row(loopId: string, k: number): LoopIterationRecord | undefined {
    return this.rows(loopId).find((r) => r.k === k);
  }

  /** Enclosing containers, nearest first, each with the iteration the instance belongs to. */
  chain(inst: InstanceState): Array<{ container: InstanceState; iteration: number | null }> {
    const out: Array<{ container: InstanceState; iteration: number | null }> = [];
    let cur: InstanceState | undefined = inst;
    const seen = new Set<string>();
    while (cur && cur.scopeId !== null && !seen.has(cur.id)) {
      seen.add(cur.id);
      const container = this.byId.get(cur.scopeId);
      if (!container) break;
      out.push({ container, iteration: cur.iterationIndex });
      cur = container;
    }
    return out;
  }
}

function scopeKey(containerId: string | null, iteration: number | null): string {
  return `${containerId ?? ''}#${iteration ?? ''}`;
}

const stageView = (i: InstanceState) => ({ status: i.status, output: i.output ?? null, summary: i.summary });

function usageView(u: Usage) {
  const tokens = u.inputTokens !== undefined || u.outputTokens !== undefined ? (u.inputTokens ?? 0) + (u.outputTokens ?? 0) : null;
  return { turns: u.turns ?? 0, costUsd: u.costUsd ?? null, tokens };
}

/** Body stage views of iteration k of a loop (by stage key). */
export function iterationStages(ix: StateIndex, loop: InstanceState, k: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const i of ix.scope(loop.id, k)) out[i.stageKey] = stageView(i);
  return out;
}

/** The failed body stages of an iteration (`onBodyFailure: next_iteration` exposes them). */
export function iterationFailures(ix: StateIndex, loop: InstanceState, k: number): Array<{ stageKey: string; code: string | null; message: string | null }> {
  return ix
    .scope(loop.id, k)
    .filter((i) => i.status === 'failed')
    .map((i) => ({ stageKey: i.stageKey, code: i.errorCode, message: i.error ?? null }));
}

/** carry(j): carryInit for j = -1, the recorded carry otherwise; null before that. */
export function carryAt(ix: StateIndex, loop: InstanceState, j: number): Record<string, unknown> | null {
  if (j < -1) return null;
  if (j === -1) return loop.loopState?.carryInit ?? {};
  return ix.row(loop.id, j)?.carry ?? null;
}

function view(ix: StateIndex, loop: InstanceState, j: number, signals?: LoopSignals | null): Record<string, unknown> | null {
  if (j < 0) return null;
  return {
    stages: iterationStages(ix, loop, j),
    signals: signalsView(signals !== undefined ? signals : (ix.row(loop.id, j)?.signals ?? null)),
    failures: iterationFailures(ix, loop, j),
  };
}

function signalsView(s: LoopSignals | null): Record<string, unknown> | null {
  if (!s) return null;
  return { toolCalls: s.toolCalls, workspaceChanged: s.workspaceChanged, stages: s.stages };
}

/** What E(k) and C(k) know that no row holds yet: the iteration's own carry and signals. */
export interface CurrentIteration {
  carry?: Record<string, unknown>;
  signals?: LoopSignals | null;
}

/** The `loop` root of `loop` in a context, for iteration k. */
export function loopRoot(ix: StateIndex, loop: InstanceState, context: LoopContext, k: number, current: CurrentIteration = {}): Record<string, unknown> {
  const ls = loop.loopState;
  const max = ls?.effectiveMax ?? 0;
  const lastK = context === 'T' ? k - 1 : k;
  const carry = context === 'E' ? (current.carry ?? carryAt(ix, loop, k)) : carryAt(ix, loop, k - 1);
  const priorCarry = context === 'E' ? carryAt(ix, loop, k - 1) : carryAt(ix, loop, k - 2);
  return {
    iteration: k,
    number: k + 1,
    maxIterations: max,
    remaining: Math.max(0, max - k - 1),
    last: context === 'T' ? view(ix, loop, lastK) : view(ix, loop, lastK, current.signals),
    previous: view(ix, loop, k - 1),
    carry: carry ?? {},
    priorCarry,
    history: ix
      .rows(loop.id)
      .filter((r) => r.k < k)
      .map((r) => ({
        k: r.k,
        exitValues: r.exitValues,
        signals: signalsView(r.signals),
        usage: usageView(r.usage),
        score: r.score,
        durationMs: r.startedAt !== null && r.endedAt !== null ? r.endedAt - r.startedAt : null,
      })),
    usage: usageView(loop.usage),
    operatorInput: ls?.operatorInput && ls.operatorInput.forIteration === k ? ls.operatorInput.text : null,
  };
}

/** `stages`: the top level plus the same iteration of every enclosing loop. */
function stagesFor(ix: StateIndex, chain: Array<{ container: InstanceState; iteration: number | null }>): Record<string, unknown> {
  const stages: Record<string, unknown> = {};
  for (const i of ix.scope(null, null)) stages[i.stageKey] = stageView(i);
  for (let n = chain.length - 1; n >= 0; n--) {
    const { container, iteration } = chain[n]!;
    if (iteration === null) continue;
    for (const i of ix.scope(container.id, iteration)) stages[i.stageKey] = stageView(i);
  }
  return stages;
}

function baseScope(run: RunRecord, variables?: Record<string, unknown>): Record<string, unknown> {
  return { variables: variables ?? run.variables, run: { id: run.id, name: run.name, codebases: run.codebases } };
}

/**
 * The scope of a place inside (or outside) the loops enclosing `inst`:
 * its templates and guards (T), or with `parent` an edge `when` from it.
 * A wrap-up instance reads its loop as T(k+1): its last iteration is k.
 */
export function instanceScope(
  ix: StateIndex,
  inst: InstanceState,
  opts: { variables?: Record<string, unknown>; parent?: Pick<InstanceState, 'status'> } = {},
): Record<string, unknown> {
  const chain = ix.chain(inst);
  const scope: Record<string, unknown> = { ...baseScope(ix.run, opts.variables), stages: stagesFor(ix, chain) };
  const loops: Record<string, unknown> = {};
  let nearest: Record<string, unknown> | undefined;
  for (const { container, iteration } of chain) {
    if (container.loopState == null) continue;
    const k = iteration ?? (isWrapUp(inst) && container.id === inst.scopeId ? container.loopState.k + 1 : container.loopState.k);
    const root = loopRoot(ix, container, 'T', k);
    loops[container.stageKey] = root;
    nearest ??= root;
  }
  if (nearest) {
    scope['loop'] = nearest;
    scope['loops'] = loops;
  }
  if (opts.parent) scope['parent'] = { status: opts.parent.status };
  return scope;
}

/** The scope of a loop's own settings: exits/score/select (E), carry (C), carryInit (before iteration 0). */
export function loopSettingsScope(
  ix: StateIndex,
  loop: InstanceState,
  context: LoopContext | 'init',
  k: number,
  current: CurrentIteration = {},
): Record<string, unknown> {
  const chain = ix.chain(loop);
  const stages = stagesFor(ix, chain);
  if (context !== 'init') Object.assign(stages, iterationStages(ix, loop, k));
  const scope: Record<string, unknown> = { ...baseScope(ix.run), stages };
  const loops: Record<string, unknown> = {};
  for (const { container, iteration } of chain) {
    if (container.loopState == null) continue;
    loops[container.stageKey] = loopRoot(ix, container, 'T', iteration ?? container.loopState.k);
  }
  if (context !== 'init') {
    const own = loopRoot(ix, loop, context, k, current);
    scope['loop'] = own;
    loops[loop.stageKey] = own;
  }
  if (Object.keys(loops).length > 0) scope['loops'] = loops;
  return scope;
}

/** The scope of an instance's templates (prompts, check env, guards): context T. */
export function templateScope(
  _graph: CompiledWorkflow,
  state: RunState,
  instance: InstanceState,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  return instanceScope(new StateIndex(state.run, state.instances, state.iterations ?? []), instance, { variables });
}

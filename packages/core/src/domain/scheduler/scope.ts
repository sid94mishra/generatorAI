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
// instances of the SAME iteration of every enclosing loop (and the same
// item of every enclosing map). `loops.<key>` is every enclosing loop.
//
// Inside a map body (P05 §4.1) `item` is the item of the nearest map,
// `map` its `{index, key, count}`, and `maps.<key>` every enclosing map's
// `{item, index, key, count}`. A map scope is keyed by the item index
// (`item_index`), a loop scope by the iteration (`iteration_index`).
// ────────────────────────────────────────────────────────────────

import { plannerKeyOf } from '@generatorai/workflow-spec';
import { compileNodes, type CompiledNode, type CompiledWorkflow } from '../workflow-graph/compile.js';
import type { ExpansionState, InstanceState, LoopIterationRecord, LoopSignals, MapState, RunRecord, RunState, Usage } from './types.js';

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
      const key = scopeKey(i.scopeId, scopeIndexOf(i));
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
      out.push({ container, iteration: scopeIndexOf(cur) });
      cur = container;
    }
    return out;
  }
}

function scopeKey(containerId: string | null, iteration: number | null): string {
  return `${containerId ?? ''}#${iteration ?? ''}`;
}

/** The scope index of an instance inside its container: a loop iteration or a map item (never both). */
export function scopeIndexOf(i: Pick<InstanceState, 'iterationIndex' | 'itemIndex'>): number | null {
  return i.iterationIndex ?? i.itemIndex ?? null;
}

/** An expansion node's state (P08 §8), when it is one. */
export function expansionStateOf(i: InstanceState): ExpansionState | null {
  return i.containerState?.kind === 'expansion' ? i.containerState : null;
}

const expansionCache = new WeakMap<ExpansionState, Map<string, CompiledNode>>();

/** The nodes of an expansion's stored plan (memoised per state object). */
export function expansionNodes(state: ExpansionState): Map<string, CompiledNode> {
  let nodes = expansionCache.get(state);
  if (!nodes) {
    nodes = compileNodes(state.stages, state.edges.map((e) => ({ from: e.from, to: e.to, on: 'success' as const })));
    expansionCache.set(state, nodes);
  }
  return nodes;
}

/** A map instance's state, when it is one. */
export function mapStateOf(i: InstanceState): MapState | null {
  return i.containerState?.kind === 'map' ? i.containerState : null;
}

/** `maps.<key>` (and the nearest map's `item` and `map`) of item `index` of a map. */
function mapRoot(map: InstanceState, index: number): { item: unknown; index: number; key: string; count: number } | null {
  const ms = mapStateOf(map);
  const it = ms?.items[index];
  if (!ms || !it) return null;
  return { item: it.item, index, key: it.key, count: ms.count };
}

/** Adds `item`/`map`/`maps` (maps) and `loop`/`loops` (loops) for a chain of enclosing containers, nearest first. */
function containerRoots(
  ix: StateIndex,
  chain: ReadonlyArray<{ container: InstanceState; iteration: number | null }>,
  loopK: (container: InstanceState, iteration: number | null) => number,
  scope: Record<string, unknown>,
): void {
  const loops: Record<string, unknown> = {};
  const maps: Record<string, unknown> = {};
  let nearestLoop: Record<string, unknown> | undefined;
  let nearestMap: { item: unknown; index: number; key: string; count: number } | undefined;
  for (const { container, iteration } of chain) {
    if (container.loopState != null) {
      const root = loopRoot(ix, container, 'T', loopK(container, iteration));
      loops[container.stageKey] = root;
      nearestLoop ??= root;
    } else if (iteration !== null) {
      const root = mapRoot(container, iteration);
      if (!root) continue;
      maps[container.stageKey] = root;
      nearestMap ??= root;
    }
  }
  if (nearestLoop) {
    scope['loop'] = nearestLoop;
    scope['loops'] = loops;
  }
  if (nearestMap) {
    scope['item'] = nearestMap.item;
    scope['map'] = { index: nearestMap.index, key: nearestMap.key, count: nearestMap.count };
    scope['maps'] = maps;
  }
}

const stageView = (i: InstanceState) => ({ status: i.status, output: i.output ?? null, summary: i.summary });

function usageView(u: Usage) {
  const tokens = u.inputTokens !== undefined || u.outputTokens !== undefined ? (u.inputTokens ?? 0) + (u.outputTokens ?? 0) : null;
  return { turns: u.turns ?? 0, costUsd: u.costUsd ?? null, tokens, toolCalls: u.toolCalls ?? 0 };
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

/** `stages`: the top level plus the same iteration (item) of every enclosing loop (map). */
function stagesFor(ix: StateIndex, chain: Array<{ container: InstanceState; iteration: number | null }>): Record<string, unknown> {
  const stages: Record<string, unknown> = {};
  const add = (scope: readonly InstanceState[]) => {
    for (const i of scope) stages[i.stageKey] = stageView(i);
    addExpansionViews(stages, scope);
  };
  add(ix.scope(null, null));
  for (let n = chain.length - 1; n >= 0; n--) {
    const { container, iteration } = chain[n]!;
    // An expansion's planned stages (P08 §8) see each other: its scope has no index.
    if (iteration === null && !expansionStateOf(container)) continue;
    add(ix.scope(container.id, iteration));
  }
  return stages;
}

/** `stages.<planner>.expansion` (P08 §8): its expansion node's status and results, for the planners of a scope. */
export function addExpansionViews(stages: Record<string, unknown>, scope: readonly InstanceState[]): void {
  for (const i of scope) {
    const planner = plannerKeyOf(i.stageKey);
    const view = planner === null ? undefined : stages[planner];
    if (!view || typeof view !== 'object') continue;
    const out = i.output as { results?: unknown } | null;
    stages[planner!] = { ...view, expansion: { status: i.status, results: Array.isArray(out?.results) ? out.results : [] } };
  }
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
  containerRoots(
    ix,
    chain,
    (container, iteration) => iteration ?? (isWrapUp(inst) && container.id === inst.scopeId ? container.loopState!.k + 1 : container.loopState!.k),
    scope,
  );
  if (opts.parent) scope['parent'] = { status: opts.parent.status };
  return scope;
}

/**
 * The scope of item `index` of a map, as its body sees it plus the item's
 * body stages: what the map's per-item `output.select` reads.
 */
export function mapItemScope(ix: StateIndex, map: InstanceState, index: number): Record<string, unknown> {
  const chain = [{ container: map, iteration: index as number | null }, ...ix.chain(map)];
  const scope: Record<string, unknown> = { ...baseScope(ix.run), stages: stagesFor(ix, chain) };
  containerRoots(ix, chain, (container, iteration) => iteration ?? container.loopState!.k, scope);
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
  containerRoots(ix, chain, (container, iteration) => iteration ?? container.loopState!.k, scope);
  if (context !== 'init') {
    const own = loopRoot(ix, loop, context, k, current);
    scope['loop'] = own;
    scope['loops'] = { ...((scope['loops'] as Record<string, unknown> | undefined) ?? {}), [loop.stageKey]: own };
  }
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

// ────────────────────────────────────────────────────────────────
// Readiness v2 (P03 WP-3.3, G5 §4.1–4.2).
//
// Join policies are evaluated PER PREDECESSOR (B-18): each predecessor is
// pending (not terminal), active (an edge from it is active and its `when`
// holds), neutral (skipped without `gate_as: completed`: that path never
// happened) or dead (it reached an outcome no edge accepts).
//
//   all     a dead predecessor skips the node (join_unsatisfiable); any
//           pending one blocks it; otherwise ready if one is active (or it
//           has none), else skipped (upstream_skipped)
//   any     ready on the first active predecessor
//   n_of_m  ready once n are active; skipped once n can no longer be
//
// Guards are evaluated only after readiness: false skips (guard_false), an
// evaluation error fails the node (condition_error) — never a silent skip.
// An edge `when` that cannot be evaluated fails the node the same way.
// ────────────────────────────────────────────────────────────────

import { evaluate, isTerminalStageRunState, type EdgeOn } from '@generatorai/workflow-spec';
import type { CompiledEdge, CompiledExpr, CompiledNode } from '../workflow-graph/compile.js';
import { addExpansionViews } from './scope.js';
import type { InstanceState, RunRecord, SkipReason } from './types.js';

export type PredState = 'pending' | 'active' | 'dead' | 'neutral';

export type Readiness =
  | { kind: 'blocked' }
  | { kind: 'ready' }
  | { kind: 'skip'; reason: SkipReason; causeId: string | null }
  | { kind: 'fail'; code: 'condition_error'; message: string };

/** Whether an edge's `on` lets control through for its source's terminal state. */
export function edgeOnMatches(on: EdgeOn, pred: Pick<InstanceState, 'status' | 'gateAs'>): boolean {
  const completed = pred.status === 'completed' || (pred.status === 'skipped' && pred.gateAs === 'completed');
  switch (on) {
    case 'success':
      return completed;
    case 'failure':
      return pred.status === 'failed';
    case 'completion':
      return completed || pred.status === 'failed';
    case 'always':
      return isTerminalStageRunState(pred.status);
  }
}

/** What guards and edge `when` read (Expression v2 scope). */
export function expressionScope(
  run: RunRecord,
  instances: readonly InstanceState[],
  parent?: Pick<InstanceState, 'status'>,
): Record<string, unknown> {
  const stages: Record<string, unknown> = {};
  const top = instances.filter((i) => i.scopeId === null);
  for (const i of top) stages[i.stageKey] = { status: i.status, output: i.output ?? null, summary: i.summary };
  addExpansionViews(stages, top);
  return {
    variables: run.variables,
    run: { id: run.id, name: run.name, codebases: run.codebases },
    stages,
    ...(parent ? { parent: { status: parent.status } } : {}),
  };
}

export type ExprOutcome = { ok: true; holds: boolean } | { ok: false; message: string };

/** Evaluate a compiled condition: only exactly `true` holds; an error or a non-boolean is an error. */
export function evalCondition(expr: CompiledExpr, scope: Record<string, unknown>): ExprOutcome {
  if ('error' in expr) return { ok: false, message: `cannot parse "${expr.source}": ${expr.error}` };
  const r = evaluate(expr.ast, scope);
  if (!r.ok) return { ok: false, message: `"${expr.source}": ${r.error.message}` };
  if (r.value === null || typeof r.value === 'boolean') return { ok: true, holds: r.value === true };
  return { ok: false, message: `"${expr.source}" is not a boolean` };
}

/** A predecessor's state for one join. `error` when an active-looking edge's `when` cannot be evaluated. */
export function predState(
  pred: InstanceState,
  edge: CompiledEdge,
  scopeFor: (parent: InstanceState) => Record<string, unknown>,
): { state: PredState; error?: string } {
  if (!isTerminalStageRunState(pred.status)) return { state: 'pending' };
  if (edgeOnMatches(edge.on, pred)) {
    if (!edge.when) return { state: 'active' };
    const w = evalCondition(edge.when, scopeFor(pred));
    if (!w.ok) return { state: 'dead', error: w.message };
    if (w.holds) return { state: 'active' };
  }
  return { state: pred.status === 'skipped' && pred.gateAs !== 'completed' ? 'neutral' : 'dead' };
}

/**
 * THE readiness predicate for one pending node. `preds` holds one entry per
 * incoming edge (one edge per pair), in the node's `incoming` order.
 */
export function readiness(
  node: CompiledNode,
  preds: ReadonlyArray<{ instance: InstanceState; state: PredState; error?: string }>,
): Readiness {
  const failed = preds.find((p) => p.error !== undefined);
  if (failed) return { kind: 'fail', code: 'condition_error', message: failed.error! };
  const count = { pending: 0, active: 0, dead: 0, neutral: 0 };
  for (const p of preds) count[p.state]++;
  const first = (s: PredState) => preds.find((p) => p.state === s)?.instance.id ?? null;
  switch (node.join.mode) {
    case 'all':
      if (count.dead > 0) return { kind: 'skip', reason: 'join_unsatisfiable', causeId: first('dead') };
      if (count.pending > 0) return { kind: 'blocked' };
      return count.active > 0 || preds.length === 0
        ? { kind: 'ready' }
        : { kind: 'skip', reason: 'upstream_skipped', causeId: first('neutral') };
    case 'any':
      if (count.active > 0) return { kind: 'ready' };
      if (count.pending > 0) return { kind: 'blocked' };
      return { kind: 'skip', reason: count.dead > 0 ? 'join_unsatisfiable' : 'upstream_skipped', causeId: first('dead') ?? first('neutral') };
    case 'n_of_m':
      if (count.active >= node.join.n) return { kind: 'ready' };
      if (count.active + count.pending < node.join.n) {
        return { kind: 'skip', reason: 'join_unsatisfiable', causeId: first('dead') ?? first('neutral') };
      }
      return { kind: 'blocked' };
  }
}

// ────────────────────────────────────────────────────────────────
// Scope outcome (P03 WP-3.3, G5 §3.6; fixes B-16 / W-29).
//
// A failed instance F is HANDLED when one of its outgoing edges is a
// failure handler (`on: failure`, or `handlesFailure: true`), is active for
// F (its `when` holds), and leads to an instance that completed or is itself
// a handled failure. `always` and `completion` edges still RUN their targets
// (cleanup, notify) but no longer absorb the failure.
//
//   any unhandled failed       → failed
//   else any unhandled cancel  → cancelled (a join's cancelled loser is handled)
//   else                       → completed
//
// `paused` is not terminal: a scope with a paused instance has no outcome.
// ────────────────────────────────────────────────────────────────

import { isTerminalStageRunState } from '@generatorai/workflow-spec';
import type { CompiledWorkflow } from '../workflow-graph/compile.js';
import { edgeOnMatches, evalCondition } from './readiness.js';
import type { InstanceState, RunOutcome } from './types.js';

/** Whether every instance of the scope is terminal. */
export function scopeTerminal(instances: readonly InstanceState[]): boolean {
  return instances.every((i) => isTerminalStageRunState(i.status));
}

/**
 * The outcome of a terminal scope. `instances` are the scope's instances;
 * `scopeFor(parent)` builds the expression scope an edge `when` sees.
 */
export function computeScopeOutcome(
  graph: CompiledWorkflow,
  instances: readonly InstanceState[],
  scopeFor: (parent: InstanceState) => Record<string, unknown>,
): RunOutcome {
  const byKey = new Map(instances.map((i) => [i.stageKey, i]));
  const failed = instances.filter((i) => i.status === 'failed');

  const handled = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of failed) {
      if (handled.has(f.id)) continue;
      const node = graph.nodes.get(f.stageKey);
      const absorbs = (node?.outgoing ?? []).some((e) => {
        if (!e.handlesFailure || !edgeOnMatches(e.on, f)) return false;
        if (e.when) {
          const w = evalCondition(e.when, scopeFor(f));
          if (!w.ok || !w.holds) return false;
        }
        const target = byKey.get(e.to);
        return !!target && (target.status === 'completed' || (target.status === 'failed' && handled.has(target.id)));
      });
      if (absorbs) {
        handled.add(f.id);
        changed = true;
      }
    }
  }

  if (failed.some((f) => !handled.has(f.id))) return 'failed';
  if (instances.some((i) => i.status === 'cancelled' && i.skipReason !== 'cancelled_loser')) return 'cancelled';
  return 'completed';
}

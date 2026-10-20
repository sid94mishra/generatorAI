// ────────────────────────────────────────────────────────────────
// Which agent stages work in a worktree of their own (D-155).
//
// Parallel stages of a run shared its folder: one read another's
// half-written files, and their edits could land on top of each other. An
// agent stage that may run while another working stage of its scope does
// (neither reaches the other through edges) — or whose enclosing container
// may — works in its own worktree cut from the run's folder when its
// attempt starts; its changes merge back when it completes (StageIsolation).
// `workspace: 'shared'` keeps a stage in the run's folder, `'isolated'`
// always forks it. Inside a map nothing forks: a mount_per_item item is a
// worktree already, and a shared map's items share by the author's choice.
// A planned stage (P08 §8) is weighed against the other steps of its plan.
// ────────────────────────────────────────────────────────────────

import type { WorkflowGraph } from '@generatorai/workflow-spec';
import { compile, type CompiledNode } from '../workflow-graph/compile.js';
import { expansionNodes, expansionStateOf, mapStateOf } from './scope.js';
import type { InstanceState, RunState } from './types.js';

/** Whether `key` may run while another working node of its scope does: neither reaches the other. */
export function hasConcurrentWorker(nodes: ReadonlyMap<string, CompiledNode>, key: string): boolean {
  const parent = nodes.get(key)?.parentKey;
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>();
    const stack = (nodes.get(from)?.outgoing ?? []).map((e) => e.to);
    while (stack.length > 0) {
      const k = stack.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push(...(nodes.get(k)?.outgoing ?? []).map((e) => e.to));
    }
    return seen;
  };
  const after = reach(key);
  for (const n of nodes.values()) {
    if (n.key === key || n.parentKey !== parent || n.class === 'wait') continue;
    if (!after.has(n.key) && !reach(n.key).has(key)) return true;
  }
  return false;
}

/** Whether an agent stage instance works in its own worktree (see the file header). */
export function worksIsolated(graph: WorkflowGraph, state: RunState, inst: InstanceState): boolean {
  const byId = new Map(state.instances.map((i) => [i.id, i]));
  const chain: InstanceState[] = [];
  for (let c = inst.scopeId ? byId.get(inst.scopeId) : undefined; c; c = c.scopeId ? byId.get(c.scopeId) : undefined) chain.push(c);
  if (chain.some((c) => mapStateOf(c) !== null)) return false;

  const planOf = (i: InstanceState) => {
    const container = i.scopeId ? byId.get(i.scopeId) : undefined;
    return container ? expansionStateOf(container) : null;
  };
  const own = planOf(inst)?.stages.find((s) => s.key === inst.stageKey) ?? graph.stages.find((s) => s.key === inst.stageKey);
  if (own?.kind !== 'agent') return false;
  if (own.workspace === 'shared') return false;
  if (own.workspace === 'isolated') return true;

  const pinned = compile(graph).nodes;
  for (const cur of [inst, ...chain]) {
    const xs = planOf(cur);
    if (hasConcurrentWorker(xs ? expansionNodes(xs) : pinned, cur.stageKey)) return true;
  }
  return false;
}

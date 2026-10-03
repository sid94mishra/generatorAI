// The list builder's graph edits (M8-05; MBuilderList, MBuilderGraph, MBuilderLoop; MD-04): the top-level order, the
// linear chains a stage may move within (every member has at most one in-edge and one out-edge, both plain success
// edges with no condition — anything else is an edge the phone does not edit), moving a stage inside its chain (the
// chain's edges are rebuilt in the new order, its entry and exit edges kept), adding a stage after the selected one
// (taking over a plain success edge, so it lands in the chain), duplicating, deleting (a chain closes over the gap),
// the edges a card shows as read-only callouts, and a stage-level diff between two graphs. Pure, unit-tested.
import { StageSpecSchema, type EdgeSpec, type StageKind, type StageSpec, type WorkflowGraph } from '@generatorai/workflow-spec';

export const KIND_NAME: Record<StageKind, string> = { agent: 'Stage', check: 'Check', loop: 'Loop', map: 'Map', subworkflow: 'Sub-workflow', wait: 'Wait' };

/** The stage key for a name: lower snake case, starts with a letter, ≤ 48, deduplicated with `_2`, `_3`… */
export function stageKeyFor(name: string, taken: ReadonlySet<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(base)) base = `stage${base ? `_${base}` : ''}`;
  base = base.slice(0, 48).replace(/_+$/, '');
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 48 - suffix.length).replace(/_+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const SEEDS: Record<StageKind, Record<string, unknown>> = {
  agent: {},
  check: { check: { command: 'npm', args: ['test'] } },
  loop: { loop: { maxIterations: 3 } },
  map: { map: { items: '[]' } },
  subworkflow: { subworkflow: { workflowRef: { name: 'child-workflow' } } },
  wait: { wait: { type: 'approval', prompt: { label: 'Approve', text: 'Approve to continue.' } } },
};

/** A new stage of `kind` in parsed form (the spec's defaults applied). */
export function newStage(kind: StageKind, graph: Pick<WorkflowGraph, 'stages'>): StageSpec {
  const taken = new Set(graph.stages.map((s) => s.key));
  const n = graph.stages.filter((s) => s.kind === kind).length + 1;
  const name = `${KIND_NAME[kind]} ${n}`;
  return StageSpecSchema.parse({ kind, key: stageKeyFor(name, taken), name, ...SEEDS[kind] });
}

const plain = (e: EdgeSpec): boolean => e.on === 'success' && !e.when && !e.handlesFailure;

/** Top-level stages in reading order: by longest-path layer, then the document's order. */
export function topLevelOrder(graph: Pick<WorkflowGraph, 'stages' | 'edges'>): StageSpec[] {
  const top = graph.stages.filter((s) => !s.parentKey);
  const keys = new Set(top.map((s) => s.key));
  const layer = new Map<string, number>();
  const depth = (key: string, seen: Set<string>): number => {
    if (layer.has(key)) return layer.get(key)!;
    if (seen.has(key)) return 0;
    seen.add(key);
    const ins = graph.edges.filter((e) => e.to === key && keys.has(e.from));
    const d = ins.length ? Math.max(...ins.map((e) => depth(e.from, seen) + 1)) : 0;
    layer.set(key, d);
    return d;
  };
  top.forEach((s) => depth(s.key, new Set()));
  const index = new Map(top.map((s, i) => [s.key, i]));
  return [...top].sort((a, b) => layer.get(a.key)! - layer.get(b.key)! || index.get(a.key)! - index.get(b.key)!);
}

/** Stage key → the id of the linear chain it belongs to (null: it has a branch, a join or a conditional edge). */
export function linearChains(graph: Pick<WorkflowGraph, 'stages' | 'edges'>): Map<string, number | null> {
  const top = topLevelOrder(graph);
  const keys = new Set(top.map((s) => s.key));
  const edges = graph.edges.filter((e) => keys.has(e.from) && keys.has(e.to));
  const linear = (key: string): boolean => {
    const ins = edges.filter((e) => e.to === key);
    const outs = edges.filter((e) => e.from === key);
    return ins.length <= 1 && outs.length <= 1 && ins.every(plain) && outs.every(plain);
  };
  const out = new Map<string, number | null>();
  let chain = 0;
  for (const s of top) {
    if (!linear(s.key)) {
      out.set(s.key, null);
      continue;
    }
    const prev = edges.find((e) => e.to === s.key);
    const prevChain = prev ? out.get(prev.from) : undefined;
    if (prevChain !== undefined && prevChain !== null && edges.filter((e) => e.from === prev!.from).length === 1) out.set(s.key, prevChain);
    else out.set(s.key, ++chain);
  }
  return out;
}

/** May the stage at `from` move to `to` (list indexes of `topLevelOrder`)? Only inside one linear chain (MD-04). */
export function canMove(order: readonly StageSpec[], chains: ReadonlyMap<string, number | null>, from: number, to: number): boolean {
  const a = order[from];
  const b = order[to];
  if (!a || !b || from === to) return false;
  const chain = chains.get(a.key);
  if (chain === null || chain === undefined) return false;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let i = lo; i <= hi; i++) if (chains.get(order[i]!.key) !== chain) return false;
  return true;
}

/** Move a stage to `toIndex` inside its chain; the chain's internal edges follow the new order. */
export function moveStage(graph: WorkflowGraph, key: string, toIndex: number): WorkflowGraph {
  const order = topLevelOrder(graph);
  const chains = linearChains(graph);
  const from = order.findIndex((s) => s.key === key);
  if (!canMove(order, chains, from, toIndex)) return graph;
  const chainId = chains.get(key);
  const members = order.filter((s) => chains.get(s.key) === chainId).map((s) => s.key);
  const next = [...members];
  const at = next.indexOf(key);
  next.splice(at, 1);
  next.splice(at + (toIndex - from), 0, key);
  const memberSet = new Set(members);
  const entry = graph.edges.find((e) => e.to === members[0] && !memberSet.has(e.from));
  const exit = graph.edges.find((e) => e.from === members[members.length - 1] && !memberSet.has(e.to));
  const kept = graph.edges.filter((e) => !memberSet.has(e.from) && !memberSet.has(e.to));
  const chainEdges: EdgeSpec[] = next.slice(1).map((k, i) => ({ from: next[i]!, to: k, on: 'success' }));
  // The chain's members take the chain's document slots in their new order.
  const slots = graph.stages.flatMap((s, i) => (memberSet.has(s.key) ? [i] : []));
  const stages = [...graph.stages];
  slots.forEach((slot, j) => {
    stages[slot] = graph.stages.find((s) => s.key === next[j])!;
  });
  return {
    ...graph,
    stages,
    edges: [...kept, ...(entry ? [{ ...entry, to: next[0]! }] : []), ...chainEdges, ...(exit ? [{ ...exit, from: next[next.length - 1]! }] : [])],
  };
}

/** Add `stage` after `afterKey` (or at the end): it takes over the selected stage's one plain success edge. */
export function insertAfter(graph: WorkflowGraph, afterKey: string | null, stage: StageSpec): WorkflowGraph {
  const order = topLevelOrder(graph);
  const after = afterKey ?? order[order.length - 1]?.key ?? null;
  const stages = [...graph.stages];
  const index = after ? stages.findIndex((s) => s.key === after) : -1;
  stages.splice(index >= 0 ? index + 1 : stages.length, 0, stage);
  if (!after) return { ...graph, stages };
  const outs = graph.edges.filter((e) => e.from === after);
  const taken = outs.length === 1 && plain(outs[0]!) ? outs[0]! : null;
  const edges = graph.edges.filter((e) => e !== taken);
  edges.push({ from: after, to: stage.key, on: 'success' });
  if (taken) edges.push({ from: stage.key, to: taken.to, on: 'success' });
  return { ...graph, stages, edges };
}

/** A copy of the stage right after it ("<name> copy", a fresh key; its body too, for a container). */
export function duplicateStage(graph: WorkflowGraph, key: string): { graph: WorkflowGraph; key: string } {
  const source = graph.stages.find((s) => s.key === key);
  if (!source) return { graph, key };
  const taken = new Set(graph.stages.map((s) => s.key));
  const copyKey = stageKeyFor(`${source.key}_copy`, taken);
  taken.add(copyKey);
  const copy = { ...source, key: copyKey, name: `${source.name} copy`.slice(0, 200) } as StageSpec;
  let next = insertAfter(graph, key, copy);
  const body = graph.stages.filter((s) => s.parentKey === key);
  if (body.length) {
    const rename = new Map(body.map((b) => [b.key, stageKeyFor(`${b.key}_copy`, taken)]));
    for (const k of rename.values()) taken.add(k);
    const stages = body.map((b) => ({ ...b, key: rename.get(b.key)!, parentKey: copyKey }) as StageSpec);
    const edges = graph.edges.filter((e) => rename.has(e.from) && rename.has(e.to)).map((e) => ({ ...e, from: rename.get(e.from)!, to: rename.get(e.to)! }));
    next = { ...next, stages: [...next.stages, ...stages], edges: [...next.edges, ...edges] };
  }
  return { graph: next, key: copyKey };
}

/** Delete a stage (and a container's body); a stage with one plain in-edge and one plain out-edge closes the gap. */
export function deleteStage(graph: WorkflowGraph, key: string): WorkflowGraph {
  const gone = new Set([key, ...graph.stages.filter((s) => s.parentKey === key).map((s) => s.key)]);
  const ins = graph.edges.filter((e) => e.to === key);
  const outs = graph.edges.filter((e) => e.from === key);
  const bridge = ins.length === 1 && outs.length === 1 && plain(ins[0]!) && plain(outs[0]!) ? { from: ins[0]!.from, to: outs[0]!.to, on: 'success' as const } : null;
  const edges = graph.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
  if (bridge && !edges.some((e) => e.from === bridge.from && e.to === bridge.to)) edges.push(bridge);
  return { ...graph, stages: graph.stages.filter((s) => !gone.has(s.key)), edges };
}

/** Move a stage one place up / down inside its chain (the menu's and the a11y actions' path). */
export function nudge(graph: WorkflowGraph, key: string, by: -1 | 1): WorkflowGraph {
  const order = topLevelOrder(graph);
  const i = order.findIndex((s) => s.key === key);
  return moveStage(graph, key, i + by);
}

export interface EdgeCallout {
  to: string;
  /** "on failure · handles failure", "when max_risk == 'high'". */
  words: string;
  dashed: boolean;
}

/** A stage's outgoing edges that are not its chain's plain next step: drawn read-only (MD-04). */
export function edgeCallouts(graph: Pick<WorkflowGraph, 'stages' | 'edges'>, key: string): EdgeCallout[] {
  const name = (k: string): string => graph.stages.find((s) => s.key === k)?.name ?? k;
  const outs = graph.edges.filter((e) => e.from === key);
  const order = topLevelOrder(graph);
  const next = order[order.findIndex((s) => s.key === key) + 1]?.key;
  return outs
    .filter((e) => !(plain(e) && e.to === next))
    .map((e) => ({
      to: name(e.to),
      words: [e.when ? `when ${e.when}` : null, e.on !== 'success' ? `on ${e.on}` : null, e.handlesFailure ? 'handles failure' : null].filter(Boolean).join(' · ') || 'on success',
      dashed: e.on !== 'success' || Boolean(e.when),
    }));
}

export interface GraphDiff {
  added: string[];
  removed: string[];
  changed: string[];
  edgesChanged: boolean;
}

/** What changed between two graphs, by stage key. */
export function graphDiff(before: Pick<WorkflowGraph, 'stages' | 'edges'>, after: Pick<WorkflowGraph, 'stages' | 'edges'>): GraphDiff {
  const a = new Map(before.stages.map((s) => [s.key, JSON.stringify(s)]));
  const b = new Map(after.stages.map((s) => [s.key, JSON.stringify(s)]));
  const edgeSet = (g: Pick<WorkflowGraph, 'edges'>): string => g.edges.map((e) => `${e.from}>${e.to}:${e.on}:${e.when ?? ''}`).sort().join('|');
  return {
    added: [...b.keys()].filter((k) => !a.has(k)),
    removed: [...a.keys()].filter((k) => !b.has(k)),
    changed: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)),
    edgesChanged: edgeSet(before) !== edgeSet(after),
  };
}

/** "+1 stage · 1 changed · edges changed", or "No changes". */
export function diffLine(d: GraphDiff): string {
  const parts = [d.added.length ? `+${d.added.length} stage${d.added.length === 1 ? '' : 's'}` : null, d.removed.length ? `−${d.removed.length} removed` : null, d.changed.length ? `${d.changed.length} changed` : null, d.edgesChanged ? 'edges changed' : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No changes';
}

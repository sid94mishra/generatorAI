// ────────────────────────────────────────────────────────────────
// Graph analysis over node ids: Kahn topological order, execution layers,
// roots, leaves, cycle members and ancestry. Pure and deterministic: ties
// follow node declaration order, then edge order.
//
// `validateWorkflow` runs it over stage keys; the v1 engine's id-keyed DAG
// builder reuses the same algorithm.
// ────────────────────────────────────────────────────────────────

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphAnalysis {
  /** Topological order; excludes nodes on or behind a cycle. */
  order: string[];
  /** Nodes grouped so that every node's predecessors are in earlier layers. */
  layers: string[][];
  /** Nodes without predecessors. */
  roots: string[];
  /** Nodes without successors. */
  leaves: string[];
  /** Nodes that could not be ordered (on or downstream of a cycle); empty for a DAG. */
  unordered: string[];
  predecessors: ReadonlyMap<string, readonly string[]>;
  successors: ReadonlyMap<string, readonly string[]>;
}

export function analyzeGraph(nodes: readonly string[], edges: readonly GraphEdge[]): GraphAnalysis {
  const known = new Set(nodes);
  const preds = new Map<string, string[]>(nodes.map((n) => [n, []]));
  const succs = new Map<string, string[]>(nodes.map((n) => [n, []]));
  const inDegree = new Map<string, number>(nodes.map((n) => [n, 0]));
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to)) continue;
    succs.get(e.from)!.push(e.to);
    preds.get(e.to)!.push(e.from);
    inDegree.set(e.to, inDegree.get(e.to)! + 1);
  }

  const remaining = new Map(inDegree);
  const order: string[] = [];
  const layers: string[][] = [];
  let layer = nodes.filter((n) => remaining.get(n) === 0);
  while (layer.length > 0) {
    layers.push(layer);
    const next: string[] = [];
    for (const n of layer) {
      order.push(n);
      for (const s of succs.get(n)!) {
        const d = remaining.get(s)! - 1;
        remaining.set(s, d);
        if (d === 0) next.push(s);
      }
    }
    layer = next;
  }
  const ordered = new Set(order);
  return {
    order: kahnOrder(nodes, succs, inDegree),
    layers,
    roots: nodes.filter((n) => inDegree.get(n) === 0),
    leaves: nodes.filter((n) => succs.get(n)!.length === 0),
    unordered: nodes.filter((n) => !ordered.has(n)),
    predecessors: preds,
    successors: succs,
  };
}

/** FIFO Kahn order (queue seeded in declaration order, successors appended in edge order). */
function kahnOrder(nodes: readonly string[], succs: Map<string, string[]>, inDegree: Map<string, number>): string[] {
  const deg = new Map(inDegree);
  const queue = nodes.filter((n) => deg.get(n) === 0);
  const out: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i]!;
    out.push(n);
    for (const s of succs.get(n)!) {
      const d = deg.get(s)! - 1;
      deg.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  return out;
}

/** Every node with a path to `node`. */
export function ancestorsOf(node: string, analysis: Pick<GraphAnalysis, 'predecessors'>): Set<string> {
  const out = new Set<string>();
  const stack = [...(analysis.predecessors.get(node) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    stack.push(...(analysis.predecessors.get(n) ?? []));
  }
  return out;
}

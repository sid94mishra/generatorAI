// ────────────────────────────────────────────────────────────────
// DAG layout for a terminal.
//
// React Flow cannot run in a terminal, but the hard part of drawing a graph
// is layer assignment and ordering, not the drawing. This does a longest-path
// layering with a barycentre pass to reduce crossings, and hands back grid
// coordinates the renderer turns into box-drawing characters.
//
// Below ~100 columns a graph stops being readable at all, so `toTree` is the
// documented fallback rather than a squeezed graph nobody can follow.
// ────────────────────────────────────────────────────────────────

export interface DagStage {
  id: string;
  name: string;
  status?: string | null;
}

export interface DagEdge {
  id?: string;
  fromStageId: string;
  toStageId: string;
  edgeType?: string;
  condition?: string | null;
}

export interface LaidOutNode extends DagStage {
  /** Distance from a root, in layers. */
  layer: number;
  /** Position within the layer. */
  index: number;
}

export interface DagLayout {
  nodes: LaidOutNode[];
  edges: DagEdge[];
  /** Node ids per layer, in draw order. */
  layers: string[][];
  /** Ids that participate in a cycle, if the graph has one. */
  cycle: string[];
  /** Stages nothing points at and which point at nothing. */
  orphans: string[];
}

/**
 * Assigns layers by longest path from a root.
 *
 * Longest-path rather than shortest: a stage that can only run after a long
 * chain must be drawn after it, and shortest-path would place it beside its
 * earliest predecessor where the dependency is invisible.
 */
export function layoutDag(stages: DagStage[], edges: DagEdge[]): DagLayout {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const stage of stages) {
    outgoing.set(stage.id, []);
    incoming.set(stage.id, []);
  }
  // Edges naming a stage that no longer exists are skipped rather than
  // fatal: a definition mid-edit is a normal state to render.
  const valid = edges.filter(
    (e) => byId.has(e.fromStageId) && byId.has(e.toStageId),
  );
  for (const edge of valid) {
    outgoing.get(edge.fromStageId)!.push(edge.toStageId);
    incoming.get(edge.toStageId)!.push(edge.fromStageId);
  }

  const cycle = detectCycle(stages, outgoing);

  const layer = new Map<string, number>();
  const visiting = new Set<string>();

  const depth = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // Cycle: break rather than recurse forever.
    visiting.add(id);

    const parents = incoming.get(id) ?? [];
    const value = parents.length === 0 ? 0 : Math.max(...parents.map(depth)) + 1;

    visiting.delete(id);
    layer.set(id, value);
    return value;
  };

  for (const stage of stages) depth(stage.id);

  const maxLayer = Math.max(0, ...[...layer.values()]);
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const stage of stages) layers[layer.get(stage.id) ?? 0]!.push(stage.id);

  // One barycentre sweep: order each layer by the mean position of its
  // parents. A single pass removes most crossings; more passes stop paying
  // for themselves at the sizes a terminal can display.
  for (let i = 1; i < layers.length; i++) {
    const previous = layers[i - 1]!;
    const position = new Map(previous.map((id, index) => [id, index]));
    layers[i]!.sort((a, b) => barycentre(a, incoming, position) - barycentre(b, incoming, position));
  }

  const nodes: LaidOutNode[] = [];
  layers.forEach((ids, layerIndex) => {
    ids.forEach((id, index) => {
      const stage = byId.get(id)!;
      nodes.push({ ...stage, layer: layerIndex, index });
    });
  });

  const orphans = stages
    .filter((s) => (incoming.get(s.id)?.length ?? 0) === 0 && (outgoing.get(s.id)?.length ?? 0) === 0)
    .map((s) => s.id);

  return { nodes, edges: valid, layers, cycle, orphans };
}

function barycentre(
  id: string,
  incoming: Map<string, string[]>,
  position: Map<string, number>,
): number {
  const parents = (incoming.get(id) ?? []).map((p) => position.get(p)).filter((p): p is number => p !== undefined);
  if (parents.length === 0) return Number.MAX_SAFE_INTEGER;
  return parents.reduce((a, b) => a + b, 0) / parents.length;
}

/** Kahn's algorithm; whatever is left over is in a cycle. */
function detectCycle(stages: DagStage[], outgoing: Map<string, string[]>): string[] {
  const indegree = new Map(stages.map((s) => [s.id, 0]));
  for (const targets of outgoing.values()) {
    for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }

  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const settled = new Set<string>();

  while (queue.length) {
    const id = queue.shift()!;
    settled.add(id);
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }

  return stages.filter((s) => !settled.has(s.id)).map((s) => s.id);
}

/**
 * The narrow-terminal fallback: an indented tree from each root.
 *
 * A node reachable by several paths appears once at its first position and is
 * marked with a back-reference afterwards, so the output stays finite on a
 * diamond.
 */
export interface TreeLine {
  id: string;
  name: string;
  status?: string | null;
  depth: number;
  /** Rendered as a repeat marker rather than expanded again. */
  repeat: boolean;
  edgeType?: string | undefined;
  isLast: boolean;
}

export function toTree(stages: DagStage[], edges: DagEdge[]): TreeLine[] {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const children = new Map<string, DagEdge[]>();
  const hasParent = new Set<string>();

  for (const edge of edges) {
    if (!byId.has(edge.fromStageId) || !byId.has(edge.toStageId)) continue;
    const list = children.get(edge.fromStageId) ?? [];
    list.push(edge);
    children.set(edge.fromStageId, list);
    hasParent.add(edge.toStageId);
  }

  const roots = stages.filter((s) => !hasParent.has(s.id));
  const emitted = new Set<string>();
  const lines: TreeLine[] = [];

  const walk = (id: string, depth: number, edgeType: string | undefined, isLast: boolean): void => {
    const stage = byId.get(id);
    if (!stage) return;

    const repeat = emitted.has(id);
    lines.push({
      id,
      name: stage.name,
      status: stage.status ?? null,
      depth,
      repeat,
      edgeType,
      isLast,
    });
    if (repeat) return;
    emitted.add(id);

    const outgoing = children.get(id) ?? [];
    outgoing.forEach((edge, index) => {
      walk(edge.toStageId, depth + 1, edge.edgeType, index === outgoing.length - 1);
    });
  };

  // Roots first, then anything a cycle left unreachable — otherwise a cyclic
  // definition renders as an empty tree and looks like data loss.
  roots.forEach((root, index) => walk(root.id, 0, undefined, index === roots.length - 1));
  for (const stage of stages) {
    if (!emitted.has(stage.id)) walk(stage.id, 0, undefined, true);
  }

  return lines;
}

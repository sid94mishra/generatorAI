// ML-31 GraphCanvas layout (03 MB-35; MD-04; MRunGraph): a layered top-to-bottom layout for a small DAG, which
// reads down a portrait phone. Layers come from the longest path from the roots; within a layer, nodes are ordered
// by the mean column of their predecessors (one barycentre pass), else by input order. Edges run from a node's
// bottom to the next node's top as cubic curves; an edge that goes back up (a cycle the caller did not break)
// bends out past the right side of the graph. Pure, unit-tested.
import type { GraphEdge, GraphEdgeInput, GraphLayout, GraphNode, GraphNodeInput } from './GraphCanvas.types';

/** Node box and gaps, in canvas points (the canvas scales the whole drawing). */
export const GRAPH_NODE = { width: 200, height: 68, gapX: 20, gapY: 40, pad: 16 } as const;

function layers(keys: readonly string[], edges: readonly GraphEdgeInput[]): Map<string, number> {
  const preds = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const e of edges) if (preds.has(e.to) && preds.has(e.from) && e.from !== e.to) preds.get(e.to)!.push(e.from);
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (key: string): number => {
    const known = layer.get(key);
    if (known !== undefined) return known;
    if (visiting.has(key)) return 0; // a cycle: break it here
    visiting.add(key);
    const ps = preds.get(key) ?? [];
    const d = ps.length === 0 ? 0 : Math.max(...ps.map((p) => depth(p) + 1));
    visiting.delete(key);
    layer.set(key, d);
    return d;
  };
  for (const k of keys) depth(k);
  return layer;
}

/** Positions for every node and a path for every edge whose ends are both laid out. */
export function layoutGraph(nodes: readonly GraphNodeInput[], edges: readonly GraphEdgeInput[]): GraphLayout {
  const keys = nodes.map((n) => n.key);
  const known = new Set(keys);
  const layerOf = layers(keys, edges);
  const columns: string[][] = []; // one entry per layer (a row of the drawing)
  for (const key of keys) {
    const l = layerOf.get(key) ?? 0;
    (columns[l] ??= []).push(key);
  }
  const row = new Map<string, number>();
  const order = new Map(keys.map((k, i) => [k, i]));
  columns.forEach((column, l) => {
    if (l > 0) {
      const mean = (key: string): number => {
        const ps = edges.filter((e) => e.to === key && row.has(e.from)).map((e) => row.get(e.from)!);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.MAX_SAFE_INTEGER;
      };
      column.sort((a, b) => mean(a) - mean(b) || order.get(a)! - order.get(b)!);
    }
    column.forEach((key, i) => row.set(key, i));
  });

  const { width: W, height: H, gapX, gapY, pad } = GRAPH_NODE;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const laid: GraphNode[] = keys.map((key) => {
    const input = byKey.get(key)!;
    return {
      key,
      label: input.label,
      x: pad + (row.get(key) ?? 0) * (W + gapX),
      y: pad + (layerOf.get(key) ?? 0) * (H + gapY),
      width: W,
      height: H,
    };
  });
  const widest = Math.max(1, ...columns.map((c) => c.length));
  const width = pad * 2 + widest * W + (widest - 1) * gapX;
  const height = pad * 2 + Math.max(1, columns.length) * H + Math.max(0, columns.length - 1) * gapY;
  const at = new Map(laid.map((n) => [n.key, n]));

  const laidEdges: GraphEdge[] = [];
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
    const a = at.get(e.from)!;
    const b = at.get(e.to)!;
    const x1 = a.x + a.width / 2;
    const y1 = a.y + a.height;
    const x2 = b.x + b.width / 2;
    const y2 = b.y;
    let path: string;
    let mid: { x: number; y: number };
    if (y2 > y1) {
      const dy = (y2 - y1) / 2;
      path = `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
      mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    } else {
      // A back edge: leave from the source's end side, come back in at the target's end side.
      const side = width - pad / 2;
      const sy = a.y + a.height / 2;
      const ty = b.y + b.height / 2;
      path = `M${a.x + a.width},${sy} C${side},${sy} ${side},${ty} ${b.x + b.width},${ty}`;
      mid = { x: side - 4, y: (sy + ty) / 2 };
    }
    laidEdges.push({ ...e, id: `${e.from}->${e.to}`, path, mid });
  }
  return { nodes: laid, edges: laidEdges, width, height };
}

/** The scale and offset that fit the layout inside a box (never above `max`). */
export function fitTransform(layout: Pick<GraphLayout, 'width' | 'height'>, box: { width: number; height: number }, max = 1.25): { scale: number; x: number; y: number } {
  if (box.width <= 0 || box.height <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = Math.min(max, box.width / layout.width, box.height / layout.height);
  return { scale, x: (box.width - layout.width * scale) / 2, y: (box.height - layout.height * scale) / 2 };
}

/** Zoom bounds of the canvas. */
export const GRAPH_ZOOM = { min: 0.3, max: 2.5, step: 1.25 } as const;

export function clampZoom(scale: number): number {
  'worklet';
  return Math.min(GRAPH_ZOOM.max, Math.max(GRAPH_ZOOM.min, scale));
}

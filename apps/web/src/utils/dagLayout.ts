// ────────────────────────────────────────────────────────────────
// DAG Auto-Layout — Uses dagre library to position nodes
// Supports left-to-right and top-to-bottom orientations
// ────────────────────────────────────────────────────────────────

import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

export type LayoutDirection = 'LR' | 'TB';

/** Default node dimensions for layout calculation */
const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 80;

/** Spacing between nodes */
const NODE_SEP = 60;
const RANK_SEP = 100;
const EDGE_SEP = 20;

/**
 * Auto-layout a DAG using dagre's hierarchical layout algorithm.
 * Returns new nodes with updated positions.
 */
export function getLayoutedElements<N extends Node = Node, E extends Edge = Edge>(
  nodes: N[],
  edges: E[],
  direction: LayoutDirection = 'LR',
): { nodes: N[]; edges: E[] } {
  if (nodes.length === 0) return { nodes, edges };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    edgesep: EDGE_SEP,
    marginx: 30,
    marginy: 30,
  });

  // Add nodes to dagre graph
  for (const node of nodes) {
    const width = node.measured?.width ?? DEFAULT_NODE_WIDTH;
    const height = node.measured?.height ?? DEFAULT_NODE_HEIGHT;
    g.setNode(node.id, { width, height });
  }

  // Add edges to dagre graph
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run layout
  dagre.layout(g);

  // Apply computed positions back to React Flow nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    const width = node.measured?.width ?? DEFAULT_NODE_WIDTH;
    const height = node.measured?.height ?? DEFAULT_NODE_HEIGHT;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return { nodes: layoutedNodes as N[], edges };
}

/**
 * Get execution layers from a DAG — groups of stages that can execute in parallel.
 * Returns an array of layers, each containing node IDs.
 */
export function getExecutionLayers(nodes: Node[], edges: Edge[]): string[][] {
  if (nodes.length === 0) return [];

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Build adjacency and in-degree
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const layers: string[][] = [];
  let currentLayer = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);

  while (currentLayer.length > 0) {
    layers.push([...currentLayer]);
    const nextLayer: string[] = [];

    for (const nodeId of currentLayer) {
      for (const dependent of adjacency.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          nextLayer.push(dependent);
        }
      }
    }

    currentLayer = nextLayer;
  }

  return layers;
}

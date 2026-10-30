// ML-31 GraphCanvas contract (03 MB-35 canvas part; MD-04, MD-25, MD-28): a read-only node graph — nodes as views
// the caller renders, edges as SVG curves (neutral; dashed for failure paths; thicker when traversed), pinch / pan /
// double-tap zoom with a zoom column (+ − Fit List). `mini` is one static button with the graph's summary.
import type { ReactElement } from 'react';

export interface GraphNodeInput {
  key: string;
  /** Spoken name of the node ("Plan, succeeded"). */
  label: string;
}

export interface GraphEdgeInput {
  from: string;
  to: string;
  /** Failure / completion paths. */
  dashed?: boolean;
  /** Traversed in a run (thicker; still neutral, MD-25). */
  emphasis?: boolean;
  /** "on failure", a `when` expression. */
  label?: string;
}

export interface GraphNode {
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphEdge extends GraphEdgeInput {
  id: string;
  /** SVG path in canvas points. */
  path: string;
  /** Where the label sits. */
  mid: { x: number; y: number };
}

export interface GraphLayout {
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
  width: number;
  height: number;
}

export interface GraphCanvasProps {
  layout: GraphLayout;
  /** The node's content, drawn inside its box. */
  renderNode: (node: GraphNode) => ReactElement;
  /** mini: a static preview button · canvas: the full pan / zoom surface. */
  variant: 'mini' | 'canvas';
  /** The graph in words ("6 stages, 1 approval gate, 2 branches"); the mini button's name. */
  summary: string;
  /** mini: opens the full graph. */
  onPress?: () => void;
  /** canvas: a node tap. Each node is an accessibility element in reading order. */
  onNodePress?: (key: string) => void;
  /** canvas: the "List" control (the equivalent list, MD-28). */
  onList?: () => void;
  /** mini: a caption over the preview ("Published v7 · read-only"). */
  caption?: string;
  testID?: string;
}

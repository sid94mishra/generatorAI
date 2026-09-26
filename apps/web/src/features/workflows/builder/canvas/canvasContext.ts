// ────────────────────────────────────────────────────────────────
// canvasContext — what the custom React Flow nodes and edges read from the
// canvas around them rather than from the store: the draft-diff tags the
// page passes in, the agent display names, and the edge under the pointer
// (React Flow reports edge hover on the root, the label lives elsewhere).
// ────────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react';

/** A node's tag in a draft diff (board WorkflowAgentDraft). */
export type NodeTag = 'added' | 'changed';

export interface CanvasContextValue {
  /** Stage key → diff tag; empty when the page shows no diff. */
  nodeTags: Readonly<Record<string, NodeTag>>;
  /** Agent ref (`scope:slug`) → display name. */
  agentNames: ReadonlyMap<string, string>;
  /** The edge under the pointer, if any. */
  hoveredEdgeId: string | null;
}

const EMPTY: CanvasContextValue = { nodeTags: {}, agentNames: new Map(), hoveredEdgeId: null };

export const CanvasContext = createContext<CanvasContextValue>(EMPTY);

export function useCanvasContext(): CanvasContextValue {
  return useContext(CanvasContext);
}

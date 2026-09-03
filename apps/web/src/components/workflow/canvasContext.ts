// ────────────────────────────────────────────────────────────────
// canvasContext — read-only flag for custom React Flow elements.
//
// React Flow's own `readonly` handling (nodesDraggable / onEdgesChange)
// cannot reach the controls a *custom* edge or node renders itself. The
// edge's delete button and its edge-type picker talk to the builder store
// directly, so without this they stayed live on the read-only definition
// canvas. Providing the flag through context keeps DAGCanvas the single
// place that decides, and custom elements just read it.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react';

export const CanvasReadonlyContext = createContext(false);

/** True when the surrounding canvas is a read-only view (no editing). */
export function useCanvasReadonly(): boolean {
  return useContext(CanvasReadonlyContext);
}

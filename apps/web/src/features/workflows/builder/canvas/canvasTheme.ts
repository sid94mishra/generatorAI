// ────────────────────────────────────────────────────────────────
// canvasTheme — the builder canvas's geometry constants and the plumbing
// that themes @xyflow/react.
//
// React Flow draws its own chrome (handles, selection box, minimap, dot
// grid) from `--xy-*` custom properties with unlayered CSS, which design
// utilities cannot override. Its documented hook is to set those properties
// on the flow root, so `XY_THEME` maps each one to a design variable
// (`var(--gai-*)`) — the same sanctioned pattern as blocks/diff/diffTheme.ts:
// an object of variables spread onto the one element the library reads,
// never a class string. A theme switch repaints without a re-render.
// ────────────────────────────────────────────────────────────────

import type { CSSProperties } from 'react';

/** Stage node header height (h-bar, 44 at every density): handles sit at its middle. */
export const STAGE_HEADER_HEIGHT = 44;
/** Handle dot size in px. */
export const HANDLE_SIZE = 8;
/** Dot grid spacing in px. */
export const GRID_GAP = 16;
/** Floating panels' distance from the canvas edge. */
export const PANEL_INSET = 12;
export const MINIMAP_WIDTH = 168;
export const MINIMAP_HEIGHT = 104;
/** The minimap appears from this many stages on (clutter on small graphs). */
export const MINIMAP_MIN_NODES = 6;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 1.5;
/** fitView options shared by the initial fit, Auto-layout and the zoom bar. */
export const FIT_OPTIONS = { padding: 0.18, maxZoom: 1.3 } as const;

/** React Flow's library variables, bound to design variables. */
export const XY_THEME = {
  '--xy-background-color': 'var(--gai-sunken)',
  '--xy-handle-background-color': 'var(--gai-surface)',
  '--xy-handle-border-color': 'var(--gai-line-strong)',
  '--xy-connectionline-stroke': 'var(--gai-fg-2)',
  '--xy-selection-background-color': 'var(--gai-selected)',
  '--xy-selection-border': '1px dashed var(--gai-fg-3)',
  '--xy-edge-stroke': 'var(--gai-line-strong)',
  '--xy-minimap-background-color': 'var(--gai-raised)',
} as CSSProperties;

/** Dot grid colour (SVG fill). */
export const GRID_COLOR = 'var(--gai-line)';

/** Minimap paints (SVG fills and strokes). */
export const MINIMAP_COLORS = {
  node: 'var(--gai-line-strong)',
  selected: 'var(--gai-fg-2)',
  groupStroke: 'var(--gai-fg-3)',
  mask: 'var(--gai-hover)',
  maskStroke: 'var(--gai-fg-3)',
  none: 'transparent',
} as const;

/** The connection line drawn while dragging from a handle. */
export const CONNECTION_LINE_STYLE: CSSProperties = { stroke: 'var(--gai-fg-2)', strokeWidth: 1.5 };

/** Stage node handles: a dot at the header's middle. */
export const STAGE_HANDLE_STYLE: CSSProperties = {
  top: STAGE_HEADER_HEIGHT / 2,
  width: HANDLE_SIZE,
  height: HANDLE_SIZE,
};

/** Panel placement (React Flow's panels carry their own margin). */
export const PANEL_STYLE: CSSProperties = { margin: PANEL_INSET };

export const MINIMAP_STYLE: CSSProperties = {
  width: MINIMAP_WIDTH,
  height: MINIMAP_HEIGHT,
  margin: PANEL_INSET,
};

/**
 * React Flow's interaction markers: elements with these classes neither start
 * a node drag nor pan the canvas (the edge label's controls, node menus).
 * Library hooks, not styles.
 */
export const XY_INTERACTIVE = 'nodrag nopan';

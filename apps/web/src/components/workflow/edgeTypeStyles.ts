// ────────────────────────────────────────────────────────────────
// edgeTypeStyles — single source of truth for DAG edge colours
// Shared by StageEdge (builder), RuntimeStageEdge (run view) and the
// DAGCanvas legend so the swatches always match the drawn edges.
// Keyed by the edge's `on` value (`EdgeSpec.on`).
// ────────────────────────────────────────────────────────────────

import { EDGE_ON_VALUES, type EdgeOn } from '@generatorai/workflow-spec';

export const EDGE_TYPE_ORDER: readonly EdgeOn[] = EDGE_ON_VALUES;

/**
 * Edge `on` → colour.
 *
 * These are CSS variables rather than hexes because the canvas is SVG: a
 * `stroke` accepts `var(--…)` exactly like a `color` does, so the edges follow
 * a theme switch with no re-render and no JS reading computed styles. They map
 * onto the STATUS tokens, not the accent — a success edge has to look like
 * success in every theme and under every accent.
 */
export const EDGE_TYPE_COLORS: Record<EdgeOn, string> = {
  success: 'var(--color-success)',
  failure: 'var(--color-danger)',
  completion: 'var(--color-info)',
  always: 'var(--color-done)',
};

/** Edge `on` → human-readable label. */
export const EDGE_TYPE_LABELS: Record<EdgeOn, string> = {
  success: 'Success',
  failure: 'Failure',
  completion: 'Complete',
  always: 'Always',
};

/** When each edge fires — shown in the pickers so the choice is obvious. */
export const EDGE_TYPE_HINTS: Record<EdgeOn, string> = {
  success: 'Source stage completed',
  failure: 'Source stage failed',
  completion: 'Completed or failed',
  always: 'Any terminal status, including skipped',
};

/** Fallback used when an edge carries an unknown/missing value. */
export const DEFAULT_EDGE_TYPE: EdgeOn = 'success';

export function edgeTypeColor(type: string | undefined): string {
  return EDGE_TYPE_COLORS[(type as EdgeOn) ?? DEFAULT_EDGE_TYPE]
    ?? EDGE_TYPE_COLORS[DEFAULT_EDGE_TYPE];
}

export function edgeTypeLabel(type: string | undefined): string {
  return EDGE_TYPE_LABELS[(type as EdgeOn) ?? DEFAULT_EDGE_TYPE]
    ?? EDGE_TYPE_LABELS[DEFAULT_EDGE_TYPE];
}

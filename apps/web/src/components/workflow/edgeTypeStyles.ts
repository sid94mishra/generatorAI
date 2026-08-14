// ────────────────────────────────────────────────────────────────
// edgeTypeStyles — single source of truth for DAG edge colours
// Shared by StageEdge (builder), RuntimeStageEdge (run view) and the
// DAGCanvas legend so the swatches always match the drawn edges.
// ────────────────────────────────────────────────────────────────

export type StageEdgeType = 'on_success' | 'on_failure' | 'on_completion' | 'always';

export const EDGE_TYPE_ORDER: StageEdgeType[] = [
  'on_success',
  'on_failure',
  'on_completion',
  'always',
];

/**
 * Edge type → colour.
 *
 * These are CSS variables rather than hexes because the canvas is SVG: a
 * `stroke` accepts `var(--…)` exactly like a `color` does, so the edges follow
 * a theme switch with no re-render and no JS reading computed styles. They map
 * onto the STATUS tokens, not the accent — a success edge has to look like
 * success in every theme and under every accent.
 */
export const EDGE_TYPE_COLORS: Record<StageEdgeType, string> = {
  on_success: 'var(--color-success)',
  on_failure: 'var(--color-danger)',
  on_completion: 'var(--color-info)',
  always: 'var(--color-done)',
};

/** Edge type → human-readable label. */
export const EDGE_TYPE_LABELS: Record<StageEdgeType, string> = {
  on_success: 'Success',
  on_failure: 'Failure',
  on_completion: 'Complete',
  always: 'Always',
};

/** Fallback used when an edge carries an unknown/missing type. */
export const DEFAULT_EDGE_TYPE: StageEdgeType = 'on_success';

export function edgeTypeColor(type: string | undefined): string {
  return EDGE_TYPE_COLORS[(type as StageEdgeType) ?? DEFAULT_EDGE_TYPE]
    ?? EDGE_TYPE_COLORS[DEFAULT_EDGE_TYPE];
}

export function edgeTypeLabel(type: string | undefined): string {
  return EDGE_TYPE_LABELS[(type as StageEdgeType) ?? DEFAULT_EDGE_TYPE]
    ?? EDGE_TYPE_LABELS[DEFAULT_EDGE_TYPE];
}

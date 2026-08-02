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

/** Edge type → colour. Chosen to stay legible on both light and dark canvases. */
export const EDGE_TYPE_COLORS: Record<StageEdgeType, string> = {
  on_success: '#16a34a', // green-600
  on_failure: '#dc2626', // red-600
  on_completion: '#2563eb', // blue-600
  always: '#7c3aed', // violet-600
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

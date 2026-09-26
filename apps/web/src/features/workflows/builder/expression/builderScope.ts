// ────────────────────────────────────────────────────────────────
// builderScope — what the expression editor knows about the workflow being
// edited (P05 WP-5B.5): the place of a field (inferred from the builder's
// selection when the field does not say) and the scope model of that place
// over the builder's current graph (cached per graph revision). The values
// of the latest run (hover) come from `useLastRunValue` (hooks).
// ────────────────────────────────────────────────────────────────

import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { buildScopeModel, type ExprPlace, type ScopeModel } from './scopeModel.js';

/**
 * A field's place. A loop's or map's own settings may leave out the key:
 * the inspector edits the selected stage.
 */
export type PlaceHint =
  | ExprPlace
  | { kind: 'loop'; context: 'E' | 'C' | 'init' }
  | { kind: 'map'; context: 'items' | 'item' | 'select' | 'winner' };

function resolvePlace(hint: PlaceHint | undefined): ExprPlace | null {
  if (!hint) return inferPlace();
  if ((hint.kind === 'loop' || hint.kind === 'map') && !('key' in hint)) {
    const stage = useWorkflowBuilderStore.getState().getSelectedStage();
    return stage ? ({ ...hint, key: stage.key } as ExprPlace) : null;
  }
  return hint as ExprPlace;
}

/** A field without an explicit place sits in the selected stage (guard, prompts) or edge (`when`). */
export function inferPlace(): ExprPlace | null {
  const s = useWorkflowBuilderStore.getState();
  if (s.selectedEdgeId) {
    const edge = s.edges.find((e) => e.id === s.selectedEdgeId)?.data?.edge;
    if (edge) return { kind: 'edge', from: edge.from };
  }
  const stage = s.getSelectedStage();
  return stage ? { kind: 'stage', key: stage.key } : null;
}

let cache: { nodes: unknown; edges: unknown; workflow: unknown; byPlace: Map<string, ScopeModel | null> } | null = null;

/** The scope model of a place over the builder's current graph. */
export function builderScopeModel(place: PlaceHint | undefined): ScopeModel | null {
  const p = resolvePlace(place);
  if (!p) return null;
  const s = useWorkflowBuilderStore.getState();
  if (!cache || cache.nodes !== s.nodes || cache.edges !== s.edges || cache.workflow !== s.workflow) {
    cache = { nodes: s.nodes, edges: s.edges, workflow: s.workflow, byPlace: new Map() };
  }
  const key = JSON.stringify(p);
  if (!cache.byPlace.has(key)) cache.byPlace.set(key, buildScopeModel(s.toGraph(), p));
  return cache.byPlace.get(key) ?? null;
}

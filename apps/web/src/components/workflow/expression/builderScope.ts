// ────────────────────────────────────────────────────────────────
// builderScope — what the expression editor knows about the workflow being
// edited (P05 WP-5B.5): the place of a field (inferred from the builder's
// selection when the field does not say), the scope model of that place
// over the builder's current graph (cached per graph revision), and the
// values of the latest run of the definition (for hover).
// ────────────────────────────────────────────────────────────────

import { evaluateSource } from '@generatorai/workflow-spec';
import type { IPlatformClient, WorkflowRun } from '@generatorai/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { workflowKeys } from '@/hooks/workflowQueries.js';
import { buildScopeModel, type ExprPlace, type ScopeModel } from './scopeModel.js';

/**
 * A field's place. A loop's or map's own settings may leave out the key:
 * the panel edits the selected stage.
 */
export type PlaceHint =
  | ExprPlace
  | { kind: 'loop'; context: 'E' | 'C' | 'init' }
  | { kind: 'map'; context: 'items' | 'item' | 'select' };

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

const STALE_MS = 30_000;

/**
 * The value of a path in the latest run of the definition being edited, or
 * null when it has no run. Only what a run records at the top level is
 * known (variables, run, top-level stages); a loop or map path has no value.
 */
export async function lastRunValue(
  platform: IPlatformClient,
  queryClient: QueryClient,
  path: string,
): Promise<{ label: string; value: unknown } | null> {
  const definitionId = useWorkflowBuilderStore.getState().definitionId;
  if (!definitionId) return null;
  const runs = await queryClient.fetchQuery({
    queryKey: workflowKeys.runsByDefinition(definitionId),
    queryFn: () => platform.listRuns({ definitionId }),
    staleTime: STALE_MS,
  });
  const latest = [...runs].sort((a: WorkflowRun, b: WorkflowRun) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (!latest) return null;
  const run = await queryClient.fetchQuery({
    queryKey: workflowKeys.run(latest.id),
    queryFn: () => platform.getRun(latest.id),
    staleTime: STALE_MS,
  });
  const stages: Record<string, unknown> = {};
  for (const sr of run.stageRuns) {
    if (sr.scopeId) continue;
    stages[sr.stageKey] = { status: sr.status, output: sr.outputData ?? sr.outputText ?? null, summary: sr.summary ?? null };
  }
  const scope = {
    variables: run.variables ?? {},
    run: { id: run.id, name: run.name, codebases: run.systemVars?.codebases ?? {} },
    stages,
  };
  const root = path.split('.')[0] ?? '';
  const label = `${run.name}, ${run.status}`;
  if (!(root in scope)) return { label, value: undefined };
  const r = evaluateSource(path, scope);
  return { label, value: r.ok ? r.value : undefined };
}

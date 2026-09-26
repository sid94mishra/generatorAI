// ────────────────────────────────────────────────────────────────
// workflowGraphDiff — what an agent's draft changes about the workflow it
// proposes to replace (the builder's agent-draft banner, P06 WP-6.5).
//
// Stages are matched by KEY (keys are the stable identity; names are labels),
// so a renamed stage reads as "changed", not "removed + added". Edges are
// matched by from → to, trigger and guard. Pure.
// ────────────────────────────────────────────────────────────────

import type { EdgeSpec, WorkflowGraph } from '@generatorai/workflow-spec';

export interface WorkflowGraphDiff {
  stagesAdded: string[];
  stagesRemoved: string[];
  /** Keys present in both whose definition differs. */
  stagesChanged: string[];
  edgesAdded: string[];
  edgesRemoved: string[];
  /** The workflow-level settings (session, lifecycle, variables, …) differ. */
  settingsChanged: boolean;
}

/** JSON with object keys sorted, so key order never reads as a change. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function edgeLabel(e: Pick<EdgeSpec, 'from' | 'to' | 'on' | 'when'>): string {
  return `${e.from} → ${e.to}${e.on && e.on !== 'success' ? ` (${e.on})` : ''}${e.when ? ` if ${e.when}` : ''}`;
}

export function diffWorkflowGraphs(before: WorkflowGraph, after: WorkflowGraph): WorkflowGraphDiff {
  const was = new Map(before.stages.map((s) => [s.key, stable(s)]));
  const now = new Map(after.stages.map((s) => [s.key, stable(s)]));
  const stagesAdded = [...now.keys()].filter((k) => !was.has(k));
  const stagesRemoved = [...was.keys()].filter((k) => !now.has(k));
  const stagesChanged = [...now.keys()].filter((k) => was.has(k) && was.get(k) !== now.get(k));

  const edgesBefore = new Set(before.edges.map(edgeLabel));
  const edgesAfter = new Set(after.edges.map(edgeLabel));
  const edgesAdded = [...edgesAfter].filter((e) => !edgesBefore.has(e));
  const edgesRemoved = [...edgesBefore].filter((e) => !edgesAfter.has(e));

  // A renamed workflow is not a settings change; the name heads the banner.
  const settingsChanged = stable({ ...before.workflow, name: '' }) !== stable({ ...after.workflow, name: '' });

  return { stagesAdded, stagesRemoved, stagesChanged, edgesAdded, edgesRemoved, settingsChanged };
}

export function isEmptyDiff(d: WorkflowGraphDiff): boolean {
  return (
    !d.settingsChanged &&
    d.stagesAdded.length + d.stagesRemoved.length + d.stagesChanged.length + d.edgesAdded.length + d.edgesRemoved.length === 0
  );
}

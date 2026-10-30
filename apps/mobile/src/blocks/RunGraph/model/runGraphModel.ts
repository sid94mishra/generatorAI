// MB-35 RunGraph model (03 MB-35; MD-04, MD-25): a workflow graph as GraphCanvas input — the top-level stages
// (loop and map bodies stay inside their container node), edges labelled by their `on` value ("on failure") or
// their `when` expression, dashed when they are not a plain success path, thicker once a run went through them; and
// the graph in words for the mini button ("6 stages, 1 approval gate, 2 branches"). Pure, unit-tested.
import type { StatusState } from '@generatorai/shared';
import type { EdgeSpec, StageSpec, WorkflowGraph } from '@generatorai/workflow-spec';

import type { GraphLayout } from '../../../ui/layout/GraphCanvas/GraphCanvas.types';
import { layoutGraph } from '../../../ui/layout/GraphCanvas/graphLayout';

export interface StageNodeStatus {
  state: StatusState;
  label: string;
  /** "3m 28s", "Queued". */
  detail?: string;
  /** The run's instance id (a tap opens it). */
  instanceId?: string;
}

export interface StageNodeView {
  key: string;
  name: string;
  kind: StageSpec['kind'];
  /** Agent ref or model, when the stage names one. */
  who?: string;
  approval: boolean;
  /** Body stages of a loop / map container. */
  children: number;
  status?: StageNodeStatus;
}

export interface RunGraphView {
  layout: GraphLayout;
  nodes: ReadonlyMap<string, StageNodeView>;
  summary: string;
}

const MAX_WHEN = 28;

function edgeLabel(e: Pick<EdgeSpec, 'on' | 'when'>): string | undefined {
  if (e.when) return e.when.length > MAX_WHEN ? `when ${e.when.slice(0, MAX_WHEN - 1)}…` : `when ${e.when}`;
  if (e.on === 'failure') return 'on failure';
  if (e.on === 'completion') return 'on completion';
  if (e.on === 'always') return 'always';
  return undefined;
}

/** Does this stage park for a person (a completion review, or an approval wait)? */
export function stageNeedsApproval(stage: StageSpec): boolean {
  if (stage.kind === 'agent') return Boolean(stage.approval);
  if (stage.kind === 'wait') return stage.wait.type === 'approval';
  return false;
}

function who(stage: StageSpec): string | undefined {
  if (stage.kind !== 'agent') return undefined;
  return stage.session?.agentRef ?? stage.session?.model ?? undefined;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function graphSummary(graph: Pick<WorkflowGraph, 'stages' | 'edges'>): string {
  const top = graph.stages.filter((s) => !s.parentKey);
  const approvals = graph.stages.filter(stageNeedsApproval).length;
  const branches = graph.edges.filter((e) => e.when || e.on !== 'success').length;
  const loops = top.filter((s) => s.kind === 'loop' || s.kind === 'map').length;
  return [plural(top.length, 'stage'), approvals ? plural(approvals, 'approval gate') : null, branches ? `${branches} ${branches === 1 ? 'branch' : 'branches'}` : null, loops ? plural(loops, 'loop') : null].filter(Boolean).join(', ');
}

/**
 * The graph for GraphCanvas. `statuses` (by stage key) colours nothing — it adds the status glyph + word to each
 * node and thickens the edges a run went through (source done, target started).
 */
export function runGraphView(graph: Pick<WorkflowGraph, 'stages' | 'edges'>, statuses?: ReadonlyMap<string, StageNodeStatus>): RunGraphView {
  const top = graph.stages.filter((s) => !s.parentKey);
  const keys = new Set(top.map((s) => s.key));
  const started = (key: string): boolean => {
    const s = statuses?.get(key)?.state;
    return s !== undefined && s !== 'queued' && s !== 'skipped';
  };
  const nodes = new Map<string, StageNodeView>();
  for (const s of top) {
    const status = statuses?.get(s.key);
    nodes.set(s.key, {
      key: s.key,
      name: s.name,
      kind: s.kind,
      ...(who(s) ? { who: who(s)! } : {}),
      approval: stageNeedsApproval(s),
      children: graph.stages.filter((c) => c.parentKey === s.key).length,
      ...(status ? { status } : {}),
    });
  }
  const edges = graph.edges
    .filter((e) => keys.has(e.from) && keys.has(e.to))
    .map((e) => {
      const label = edgeLabel(e);
      return {
        from: e.from,
        to: e.to,
        ...(e.on !== 'success' || e.when ? { dashed: true } : {}),
        ...(statuses && statuses.get(e.from)?.state === 'succeeded' && started(e.to) ? { emphasis: true } : {}),
        ...(label ? { label } : {}),
      };
    });
  const layout = layoutGraph(
    top.map((s) => {
      const st = statuses?.get(s.key);
      return { key: s.key, label: st ? `${s.name}, ${st.label}` : s.name };
    }),
    edges,
  );
  return { layout, nodes, summary: graphSummary(graph) };
}

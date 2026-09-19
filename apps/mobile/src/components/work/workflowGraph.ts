export interface WorkflowEdge {
  fromStageId?: string;
  toStageId?: string;
  from?: string;
  to?: string;
  source?: string;
  target?: string;
  sourceStageId?: string;
  targetStageId?: string;
  edgeType?: string;
}

/** REST uses fromStageId/toStageId; older imported graphs used canvas keys. */
export function incomingStages(edges: readonly WorkflowEdge[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const edge of edges) {
    const from = edge.fromStageId ?? edge.from ?? edge.source ?? edge.sourceStageId;
    const to = edge.toStageId ?? edge.to ?? edge.target ?? edge.targetStageId;
    if (!from || !to) continue;
    const previous = result.get(to) ?? [];
    if (!previous.includes(from)) result.set(to, [...previous, from]);
  }
  return result;
}

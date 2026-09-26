// ────────────────────────────────────────────────────────────────
// Workflow graph — pure reads of a v2 `WorkflowGraph`
// (@generatorai/workflow-spec) for the workflow screen.
//
// Tested in src/__tests__/workflowGraph.test.ts.
// ────────────────────────────────────────────────────────────────

/** Stage key → the keys of the stages it waits on (edges and `context.from` use keys). */
export function incomingStages(edges: ReadonlyArray<{ from: string; to: string }>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const edge of edges) {
    const previous = result.get(edge.to) ?? [];
    if (!previous.includes(edge.from)) result.set(edge.to, [...previous, edge.from]);
  }
  return result;
}

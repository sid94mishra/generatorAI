/** Database update order is not execution order; retain the run's frozen outline. */
export function orderStageRuns<T extends { id: string; stageDefinitionId: string; iterationIndex?: number }>(
  stages: readonly T[],
  definitions: readonly { id: string; order: number }[] | undefined,
): T[] {
  if (!definitions?.length) return [...stages];
  const order = new Map(definitions.map((stage) => [stage.id, stage.order]));
  return [...stages].sort((a, b) =>
    (order.get(a.stageDefinitionId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.stageDefinitionId) ?? Number.MAX_SAFE_INTEGER) ||
    (a.iterationIndex ?? 0) - (b.iterationIndex ?? 0) || a.id.localeCompare(b.id),
  );
}

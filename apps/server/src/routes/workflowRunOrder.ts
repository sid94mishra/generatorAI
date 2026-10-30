/** Database update order is not execution order; list stage runs in the pinned graph's stage order. */
export function orderStageRuns<T extends { id: string; stageKey: string }>(
  stages: readonly T[],
  stageKeys: readonly string[] | undefined,
): T[] {
  if (!stageKeys?.length) return [...stages];
  const order = new Map(stageKeys.map((key, i) => [key, i]));
  return [...stages].sort((a, b) =>
    (order.get(a.stageKey) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.stageKey) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
  );
}

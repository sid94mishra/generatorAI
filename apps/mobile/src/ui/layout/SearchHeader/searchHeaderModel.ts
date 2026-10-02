// Pure SearchHeader copy (03 ML-28). Unit-tested.
export function resultCountLabel(count: number): string {
  return count === 1 ? '1 result' : `${count} results`;
}

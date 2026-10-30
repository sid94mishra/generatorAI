// Pure ReorderList logic (03 ML-16): the allowed moves and the accessibility actions per row.
export function allowedMove(from: number, to: number, count: number, canMove?: (from: number, to: number) => boolean): boolean {
  if (from === to || to < 0 || to >= count) return false;
  return canMove ? canMove(from, to) : true;
}

export function moveActions(index: number, count: number, canMove?: (from: number, to: number) => boolean): Array<{ name: string; label: string }> {
  const out: Array<{ name: string; label: string }> = [];
  if (allowedMove(index, index - 1, count, canMove)) out.push({ name: 'moveUp', label: 'Move up' });
  if (allowedMove(index, index + 1, count, canMove)) out.push({ name: 'moveDown', label: 'Move down' });
  return out;
}

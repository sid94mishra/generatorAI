// MSetStorage: the inline result of "Clean up" (MDF-119: not a toast). Pure.

export function cleanupSummary(r: { tracked: number; orphans: number; failed: number }): string {
  const removed = r.tracked + r.orphans;
  const head = removed === 0 ? 'Nothing was old enough to remove' : `Removed ${removed} workspace${removed === 1 ? '' : 's'}${r.orphans ? ` (${r.orphans} orphaned)` : ''}`;
  return r.failed > 0 ? `${head}; ${r.failed} in use will be retried tonight.` : `${head}.`;
}

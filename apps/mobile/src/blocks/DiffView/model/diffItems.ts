// The DiffView's list items (MB-24; MD-61), pure: the diff rows (hunk headers, lines, notices) with the review threads
// drawn inline after the line they anchor to (their last line, on their side) and the inline comment composer after
// the selected line. A thread whose anchor line is not in the shown rows (a collapsed hunk, an outdated anchor)
// collects at the end so it is never lost.
import type { ReviewThread } from '@generatorai/client-core';

import type { DiffRowModel, DiffSide } from './diffModel';

export interface LineAnchor {
  side: DiffSide;
  line: number;
}

export type DiffItem =
  | DiffRowModel
  | { type: 'thread'; key: string; thread: ReviewThread }
  | { type: 'composer'; key: string; anchor: LineAnchor };

export const anchorKey = (a: LineAnchor): string => `${a.side}:${a.line}`;

export function diffItems(rows: readonly DiffRowModel[], threads: readonly ReviewThread[], composer: LineAnchor | null): DiffItem[] {
  const byAnchor = new Map<string, ReviewThread[]>();
  for (const t of threads) {
    const key = anchorKey({ side: t.side, line: t.endLine });
    const list = byAnchor.get(key);
    if (list) list.push(t);
    else byAnchor.set(key, [t]);
  }
  const placed = new Set<string>();
  const out: DiffItem[] = [];
  for (const row of rows) {
    out.push(row);
    if (row.type !== 'line') continue;
    const key = anchorKey(row.anchor);
    if (!placed.has(key)) {
      for (const thread of byAnchor.get(key) ?? []) out.push({ type: 'thread', key: `t-${thread.id}`, thread });
      placed.add(key);
    }
    if (composer && anchorKey(composer) === key && !out.some((i) => i.type === 'composer')) out.push({ type: 'composer', key: 'composer', anchor: composer });
  }
  for (const [key, list] of byAnchor) {
    if (placed.has(key)) continue;
    for (const thread of list) out.push({ type: 'thread', key: `t-${thread.id}`, thread });
  }
  return out;
}

/** Open threads (not resolved or outdated) per anchor, for the line's comment chip. */
export function openThreadCounts(threads: readonly ReviewThread[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of threads) {
    if (t.status === 'resolved' || t.status === 'outdated') continue;
    const key = anchorKey({ side: t.side, line: t.endLine });
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** "File 1 of 2" and the neighbours for the footer (MPaneDiff). */
export function fileNeighbours<T extends { id: string }>(files: readonly T[], id: string): { index: number; total: number; prev: T | null; next: T | null } {
  const index = files.findIndex((f) => f.id === id);
  return { index, total: files.length, prev: index > 0 ? files[index - 1]! : null, next: index >= 0 && index < files.length - 1 ? files[index + 1]! : null };
}

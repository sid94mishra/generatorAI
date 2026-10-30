// Change rows, pure (03 MB-22): the status letter and its tone (shared `CHANGE_KIND`: M warn, A ok, D err, R run),
// the path split into a dimmed directory and the name, a file's identity across mounts, the checkpoint kinds' names
// (web's CHECKPOINT_KIND_LABEL), and the rows flattened out of a change summary.
import { CHANGE_KIND } from '@generatorai/shared/client';
import type { ChangeFileEntry, ChangeSummary } from '@generatorai/client-core';

export type ChangeStatus = ChangeFileEntry['status'];

export function changeLetter(status: ChangeStatus): string {
  return CHANGE_KIND[status].letter;
}
export function changeTone(status: ChangeStatus): 'ok' | 'warn' | 'err' | 'run' | 'fg-3' {
  return CHANGE_KIND[status].tone;
}
export function changeLabel(status: ChangeStatus): string {
  return CHANGE_KIND[status].label;
}

/** Web's `CHECKPOINT_KIND_LABEL`, so both apps name the same snapshot alike. */
export const CHECKPOINT_LABEL: Record<string, string> = {
  baseline: 'Session start',
  turn: 'Chat turn',
  stage: 'Stage',
  autorun: 'Automation',
  live: 'Auto-save',
  manual: 'Manual snapshot',
  pre_restore: 'Redo point',
};

export function checkpointLabel(record: { kind: string; label?: string | null }): string {
  return record.label ?? CHECKPOINT_LABEL[record.kind] ?? record.kind;
}

/** `foo/bar/baz.ts` → `{ dir: 'foo/bar/', name: 'baz.ts' }` (the dir keeps its slash for drawing). */
export function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash + 1) };
}

/** Stable identity for a file across mounts: `alias:path`. */
export function fileId(alias: string, path: string): string {
  return `${alias}:${path}`;
}

export type ChangeRow = ChangeFileEntry & { alias: string; id: string };

/** Every changed file of a summary, in mount order, tagged with its mount. */
export function changeRows(summary: ChangeSummary | undefined): ChangeRow[] {
  return (summary?.repos ?? []).flatMap((repo) => repo.files.map((file) => ({ ...file, alias: repo.alias, id: fileId(repo.alias, file.path) })));
}

/** Spoken row: "Modified, src/cart/applyCoupon.ts, 14 added, 6 removed". */
export function changeRowLabel(row: Pick<ChangeRow, 'status' | 'path' | 'oldPath' | 'additions' | 'deletions'>, comments = 0): string {
  const path = row.status === 'renamed' && row.oldPath ? `${row.oldPath} renamed to ${row.path}` : row.path;
  const parts = [changeLabel(row.status), path, `${row.additions} added`, `${row.deletions} removed`];
  if (comments > 0) parts.push(`${comments} ${comments === 1 ? 'comment' : 'comments'}`);
  return parts.join(', ');
}

export function formatBytes(size: number): string {
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

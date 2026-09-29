import { CHANGE_KIND } from '@generatorai/shared/client';
// ────────────────────────────────────────────────────────────────
// Change status presentation — ONE table for every Changes surface.
//
// D20 was two surfaces drawing the same status in different colours
// (`text-info` for modified on the route, `text-warning` in the workbench).
// Every renderer now reads from here, so the letter and tone a file gets in
// the composer tray is the letter and tone it gets full screen.
//
// Web's STATUS_STYLE, letter for letter.
// ────────────────────────────────────────────────────────────────

import type { ChangeFileEntry } from '@generatorai/client-core';

export type ChangeStatus = ChangeFileEntry['status'];

const TONE_TEXT = { ok: 'text-success', warn: 'text-warning', err: 'text-danger', run: 'text-info' } as const;
const TONE_BG = { ok: 'bg-success-muted', warn: 'bg-warning-muted', err: 'bg-danger-muted', run: 'bg-info-muted' } as const;
const CHANGE_STATUSES: ChangeStatus[] = ['added', 'modified', 'deleted', 'renamed'];
function fromChanges(value: (status: ChangeStatus) => string): Record<ChangeStatus, string> {
  return Object.fromEntries(CHANGE_STATUSES.map(status => [status, value(status)])) as Record<ChangeStatus, string>;
}
export const STATUS_TONE = fromChanges(status => TONE_TEXT[CHANGE_KIND[status].tone]);
export const STATUS_BG = fromChanges(status => TONE_BG[CHANGE_KIND[status].tone]);
export const STATUS_LETTER = fromChanges(status => CHANGE_KIND[status].letter);
export const STATUS_TITLE = fromChanges(status => CHANGE_KIND[status].label);

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

/** `foo/bar/baz.ts` → `baz.ts` and `foo/bar`. */
export function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

/** Stable identity for a file across repos: `alias:path`. */
export function fileId(alias: string, path: string): string {
  return `${alias}:${path}`;
}

/** The path the server wants for a discard: alias-prefixed unless root. */
export function restorePath(alias: string, path: string): string {
  return alias === '.' || !alias ? path : `${alias}/${path}`;
}

export function formatBytes(size: number): string {
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

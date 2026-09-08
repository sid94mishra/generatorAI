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

export const STATUS_TONE: Record<ChangeStatus, string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
  renamed: 'text-info',
};

export const STATUS_BG: Record<ChangeStatus, string> = {
  added: 'bg-success-muted',
  modified: 'bg-warning-muted',
  deleted: 'bg-danger-muted',
  renamed: 'bg-info-muted',
};

export const STATUS_LETTER: Record<ChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

export const STATUS_TITLE: Record<ChangeStatus, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
};

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

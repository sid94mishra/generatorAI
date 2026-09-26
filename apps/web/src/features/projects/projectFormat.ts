// ────────────────────────────────────────────────────────────────
// Projects-area formatting and label maps (P5-02…P5-06). Pure helpers shared
// by the Projects list, Create project, ProjectDetail, CodebaseDetail and the
// pull-request page; no React.
// ────────────────────────────────────────────────────────────────

import { HEALTH, type CodebaseStatus, type CodebaseType, type WorktreeRetentionPolicy } from '@generatorai/shared';

export const RETENTION_OPTIONS: readonly { value: WorktreeRetentionPolicy; label: string; short: string }[] = [
  { value: 'immediate', label: 'Immediate cleanup', short: 'Immediate' },
  { value: 'hours-24', label: 'Keep for 24 hours', short: '24 h' },
  { value: 'hours-72', label: 'Keep for 72 hours', short: '72 h' },
  { value: 'manual', label: 'Manual cleanup only', short: 'Manual' },
];

export const DEFAULT_RETENTION: WorktreeRetentionPolicy = 'hours-24';
export const DEFAULT_MAX_CODEBASES = 10;
export const MAX_CODEBASES_LIMIT = 50;

/** One sentence under the retention control (mobile `MProjectCreate` copy). */
export function retentionHint(policy: WorktreeRetentionPolicy): string {
  switch (policy) {
    case 'immediate':
      return 'Completed worktrees are removed as soon as their chat or run ends.';
    case 'hours-24':
      return 'Completed worktrees are removed 24 h after their chat or run ends.';
    case 'hours-72':
      return 'Completed worktrees are removed 72 h after their chat or run ends.';
    case 'manual':
      return 'Completed worktrees stay until you remove them.';
  }
}

export function retentionLabel(policy: WorktreeRetentionPolicy | undefined): string {
  return RETENTION_OPTIONS.find((o) => o.value === (policy ?? DEFAULT_RETENTION))?.short ?? '24 h';
}

export const CODEBASE_TYPE_LABEL: Record<CodebaseType, string> = {
  'git-remote': 'Git remote',
  'git-local': 'Local git',
  'local-dir': 'Local folder',
};

export const CODEBASE_TYPE_ITEMS: readonly { value: CodebaseType; label: string }[] = [
  { value: 'git-remote', label: 'Git remote' },
  { value: 'git-local', label: 'Local git' },
  { value: 'local-dir', label: 'Local folder' },
];

/** What the Source segment means, one line (mobile `MAddCodebase` copy). */
export const CODEBASE_TYPE_HINT: Record<CodebaseType, string> = {
  'git-remote': 'Cloned into the project root; Fetch keeps it current.',
  'git-local': 'A git repository on the server machine; chats and runs work in worktrees of it.',
  'local-dir': 'A plain folder on the server machine; agents edit it in place.',
};

/** True while an async git job (clone or fetch, G-16) runs for the codebase. */
export function isCodebaseBusy(status: CodebaseStatus): boolean {
  return status === 'cloning' || status === 'pending';
}

export interface CodebaseStatusView {
  tone: 'ok' | 'warn' | 'err' | 'idle' | 'run';
  label: string;
}

/**
 * Status word for a codebase. G-16 reuses `cloning` for a fetch in flight; a
 * finished clone always stamps `lastFetchedAt`, so `cloning` with a
 * `lastFetchedAt` is a fetch.
 */
export function codebaseStatusView(codebase: { status: CodebaseStatus; lastFetchedAt?: Date | string }): CodebaseStatusView {
  if (codebase.status === 'cloning' && codebase.lastFetchedAt) return { tone: 'run', label: 'Fetching' };
  return HEALTH.codebase[codebase.status];
}

/** The codebase's origin: remote URL or local path. */
export function codebaseLocation(codebase: { url?: string; localPath?: string; clonePath?: string }): string {
  return codebase.url ?? codebase.localPath ?? codebase.clonePath ?? '—';
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1.27 GB, 385 MB, 12 KB (base 1024, one decimal under 10). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** 0:38, 4:12, 1:05:09 — elapsed wall time. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "in 26h", "in 3d", "soon" — time until a future instant. */
export function formatUntil(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 60_000) return 'soon';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/** Aug 4 — short calendar date. */
export function formatShortDate(value: Date | string): string {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Plural helper: `plural(2, 'codebase')` → "2 codebases". */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

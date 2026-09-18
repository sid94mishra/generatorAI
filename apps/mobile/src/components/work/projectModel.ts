// ────────────────────────────────────────────────────────────────
// Project model — what the project overview and codebase screens show.
//
// Pure, so the rules are testable without React Native:
//   • which runs belong to a project (the server has no project filter on
//     `/api/workflow-runs`),
//   • "most recent N" ordering over wire timestamps,
//   • how a codebase location is shortened for a phone-width row,
//   • which facts of a loosely typed status / readiness payload are worth
//     showing.
// ────────────────────────────────────────────────────────────────

import { epochOr, type Timestamp } from '@generatorai/client-core';

import { isActive, needsAttention } from '../runs/statusStyle';

export type ProjectTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

// ── Runs ────────────────────────────────────────────────────────

export interface ProjectRunLike {
  workflowDefinitionId: string;
  variables?: Record<string, unknown>;
}

/**
 * A project's runs: those of one of its workflows, or those started FOR the
 * project (which carry it as `variables.__projectId`, e.g. a global workflow
 * run against this project).
 */
export function projectRuns<T extends ProjectRunLike>(
  runs: readonly T[],
  workflowIds: Iterable<string>,
  projectId: string,
): T[] {
  const ids = new Set(workflowIds);
  return runs.filter(
    (run) => ids.has(run.workflowDefinitionId) || run.variables?.['__projectId'] === projectId,
  );
}

/** Runs parked on a person (paused, awaiting input, failed), newest first. */
export function runsNeedingYou<T extends ProjectRunLike & { status: string; updatedAt?: Timestamp; createdAt?: Timestamp }>(
  runs: readonly T[],
): T[] {
  return mostRecent(
    runs.filter((run) => needsAttention(run.status)),
    runs.length,
  );
}

/** One status tone per run row. */
export function runTone(status: string): ProjectTone {
  if (status === 'failed') return 'danger';
  if (needsAttention(status)) return 'warning';
  if (isActive(status)) return 'info';
  if (status === 'completed') return 'success';
  return 'neutral';
}

// ── Ordering ────────────────────────────────────────────────────

/**
 * Newest first by `updatedAt` (falling back to `createdAt`), capped at
 * `limit`. Unparseable timestamps sort last; the input is not mutated.
 */
export function mostRecent<T extends { updatedAt?: Timestamp | null; createdAt?: Timestamp | null }>(
  items: readonly T[],
  limit: number,
): T[] {
  const at = (item: T): number => epochOr(item.updatedAt ?? item.createdAt ?? null, 0);
  return [...items].sort((a, b) => at(b) - at(a)).slice(0, Math.max(0, limit));
}

// ── Codebases ───────────────────────────────────────────────────

export type CodebaseKind = 'git-remote' | 'git-local' | 'local-dir';

export interface CodebaseLocation {
  /** Short label: `owner/repo` for a remote, the folder name for a path. */
  primary: string;
  /** The full URL or path, for a monospace line and copy. Empty when unknown. */
  secondary: string;
}

function trimTrailingSeparators(value: string): string {
  // Keep a bare root (`/`, `C:\`) meaningful rather than trimming it to "".
  const trimmed = value.replace(/[\\/]+$/, '');
  return trimmed.length > 0 ? trimmed : value;
}

function lastPathSegment(path: string): string {
  const trimmed = trimTrailingSeparators(path.trim());
  const parts = trimmed.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1]! : trimmed;
}

/** `owner/repo` from an https, ssh:// or scp-style (`git@host:owner/repo.git`) URL. */
export function repoSlugFromUrl(url: string): string | null {
  const raw = trimTrailingSeparators(url.trim());
  if (!raw) return null;
  let path: string | null = null;

  const scp = /^[^@\s/]+@[^:\s/]+:(.+)$/.exec(raw);
  if (scp) {
    path = scp[1]!;
  } else {
    const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/?(.*)$/i.exec(raw);
    if (scheme) path = scheme[1] ?? '';
  }
  if (path === null) return null;

  const parts = path
    .replace(/\.git$/i, '')
    .split('/')
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  return parts.slice(-2).join('/');
}

export function codebaseLocation(codebase: {
  type?: string;
  url?: string | null;
  localPath?: string | null;
  alias?: string;
}): CodebaseLocation {
  const url = codebase.url?.trim();
  const localPath = codebase.localPath?.trim();

  if (url && (codebase.type === 'git-remote' || !localPath)) {
    return { primary: repoSlugFromUrl(url) ?? lastPathSegment(url), secondary: url };
  }
  if (localPath) {
    return { primary: lastPathSegment(localPath), secondary: localPath };
  }
  return { primary: codebase.alias ?? codebaseTypeLabel(codebase.type), secondary: '' };
}

/**
 * Whether "fetched 3h ago / never fetched" means anything for this codebase.
 * A local folder or local checkout is read in place — it is never fetched,
 * so "never fetched" would read as a fault.
 */
export function showsFetchState(type: string | undefined): boolean {
  return type === 'git-remote';
}

export function codebaseTypeLabel(type: string | undefined): string {
  switch (type) {
    case 'git-remote':
      return 'Git remote';
    case 'git-local':
      return 'Local git repository';
    case 'local-dir':
      return 'Local folder';
    default:
      return 'Codebase';
  }
}

/** Statuses that are the normal resting state and therefore get no badge. */
export function isQuietCodebaseStatus(status: string | undefined | null): boolean {
  return !status || status === 'ready' || status === 'synced';
}

export function codebaseStatusTone(status: string | undefined | null): ProjectTone {
  if (status === 'ready' || status === 'synced') return 'success';
  if (status === 'error' || status === 'failed') return 'danger';
  if (status === 'stale') return 'warning';
  if (status === 'syncing' || status === 'cloning' || status === 'pending') return 'info';
  return 'neutral';
}

// ── Defensive fact extraction ───────────────────────────────────

export interface Fact {
  label: string;
  value: string;
  tone?: ProjectTone;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `GET …/codebases/:cid/status` → the error, if any, and the checkout path. */
export function statusFacts(status: unknown): { lastError: string | null; clonePath: string | null; status: string | null } {
  const r = record(status);
  return {
    lastError: r ? str(r['lastError']) : null,
    clonePath: r ? str(r['clonePath']) : null,
    status: r ? str(r['status']) : null,
  };
}

/**
 * `GET …/codebases/:cid/readiness` (a `RepoReadiness`) → the handful of facts
 * a person acts on. Anything missing or of an unexpected type is skipped.
 */
export function readinessFacts(readiness: unknown): Fact[] {
  const r = record(readiness);
  if (!r) return [];
  const facts: Fact[] = [];

  const branch = str(r['branch']);
  if (branch) facts.push({ label: 'Current branch', value: branch });
  else if (r['detached'] === true) facts.push({ label: 'Current branch', value: 'Detached HEAD', tone: 'warning' });

  if (typeof r['dirty'] === 'boolean') {
    const changed = num(r['changedFiles']);
    facts.push(
      r['dirty']
        ? {
            label: 'Working tree',
            value: changed ? `${changed} changed file${changed === 1 ? '' : 's'}` : 'Uncommitted changes',
            tone: 'warning',
          }
        : { label: 'Working tree', value: 'Clean' },
    );
  }

  const ahead = num(r['ahead']);
  const behind = num(r['behind']);
  if (ahead !== null || behind !== null) {
    facts.push({ label: 'Upstream', value: `${ahead ?? 0} ahead · ${behind ?? 0} behind` });
  } else if (r['hasUpstream'] === false && r['hasRemote'] === true) {
    facts.push({ label: 'Upstream', value: 'Not tracking a remote branch' });
  }

  if (r['hasRemote'] === false) facts.push({ label: 'Remote', value: 'None configured' });
  if (typeof r['connected'] === 'boolean' && r['hasRemote'] !== false) {
    facts.push(
      r['connected']
        ? { label: 'Account', value: 'Connected' }
        : { label: 'Account', value: 'Not connected', tone: 'warning' },
    );
  }

  if (r['mergeInProgress'] === true) facts.push({ label: 'Merge', value: 'In progress', tone: 'warning' });
  const conflicted = Array.isArray(r['conflictedFiles']) ? r['conflictedFiles'].length : 0;
  if (conflicted > 0) {
    facts.push({ label: 'Conflicts', value: `${conflicted} file${conflicted === 1 ? '' : 's'}`, tone: 'danger' });
  }
  return facts;
}

/** Branch names for a collapsed list: the default first, then the rest in order. */
export function orderBranches(branches: unknown, defaultBranch?: string | null): string[] {
  if (!Array.isArray(branches)) return [];
  const names = branches.filter((b): b is string => typeof b === 'string' && b.length > 0);
  if (!defaultBranch || !names.includes(defaultBranch)) return names;
  return [defaultBranch, ...names.filter((b) => b !== defaultBranch)];
}

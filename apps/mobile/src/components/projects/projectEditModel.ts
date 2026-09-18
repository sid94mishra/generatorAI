// ────────────────────────────────────────────────────────────────
// projectEditModel — pure rules behind project authoring on the phone.
//
// Creating a project, adding a repository by git URL, following a clone,
// editing project settings, browsing a codebase read-only and toggling an
// MCP server. No React Native imports: everything here is tested under
// vitest (src/__tests__/projectEditModel.test.ts).
// ────────────────────────────────────────────────────────────────

import { repoSlugFromUrl } from '../work/projectModel';

// ── Names and URLs ──────────────────────────────────────────────

export const PROJECT_NAME_MAX = 120;

export function validateProjectName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the project a name.';
  if (trimmed.length > PROJECT_NAME_MAX) return `Keep the name under ${PROJECT_NAME_MAX} characters.`;
  return null;
}

/**
 * Whether a string is a git remote the host can clone: `https://…`,
 * `ssh://…`, `git://…` or scp-style `git@host:owner/repo(.git)`.
 * A bare path is rejected on purpose — local folders are not linkable from a
 * phone (see `codebaseLinkLocal` in featureGate).
 */
export function validateGitUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return 'Paste the repository URL.';
  if (/\s/.test(raw)) return 'A repository URL cannot contain spaces.';
  const scheme = /^(https?|ssh|git):\/\/[^/\s]+\/.+/i.test(raw);
  const scp = /^[^@\s/]+@[^:\s/]+:\S+$/.test(raw);
  if (!scheme && !scp) {
    if (/^([a-z]:)?[\\/.~]/i.test(raw)) {
      return 'Local folders can only be linked from the machine running GeneratorAI. Use the repository URL.';
    }
    return 'Use an https:// or git@host:owner/repo URL.';
  }
  if (!repoSlugFromUrl(raw)) return 'That URL has no repository path.';
  return null;
}

/** Short alias for a repository: its name, lower-cased, safe for a folder. */
export function aliasFromGitUrl(url: string): string {
  const slug = repoSlugFromUrl(url.trim());
  const name = slug ? (slug.split('/').pop() ?? '') : '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `base`, or `base-2`, `base-3`… — the first not already taken (case-insensitive). */
export function uniqueAlias(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  const root = base.trim() || 'repo';
  if (!used.has(root.toLowerCase())) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root}-${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

export interface RepoDraft {
  url: string;
  alias?: string;
  branch?: string;
}

export interface GitCodebaseBody {
  alias: string;
  type: 'git-remote';
  url: string;
  defaultBranch?: string;
}

/**
 * The `POST /projects/:id/codebases` bodies for a set of repo drafts.
 * Blank rows are dropped; aliases default to the repo name and are made
 * unique against each other and against `existingAliases`.
 */
export function gitCodebaseBodies(
  drafts: readonly RepoDraft[],
  existingAliases: Iterable<string> = [],
): GitCodebaseBody[] {
  const taken = new Set([...existingAliases]);
  const out: GitCodebaseBody[] = [];
  for (const draft of drafts) {
    const url = draft.url.trim();
    if (!url) continue;
    const alias = uniqueAlias(draft.alias?.trim() || aliasFromGitUrl(url) || 'repo', taken);
    taken.add(alias);
    const branch = draft.branch?.trim();
    out.push({ alias, type: 'git-remote', url, ...(branch ? { defaultBranch: branch } : {}) });
  }
  return out;
}

/** Validation problems across the drafts, keyed by row index. Blank rows are fine. */
export function repoDraftErrors(drafts: readonly RepoDraft[]): Record<number, string> {
  const errors: Record<number, string> = {};
  drafts.forEach((draft, index) => {
    if (!draft.url.trim()) return;
    const error = validateGitUrl(draft.url);
    if (error) errors[index] = error;
  });
  return errors;
}

// ── Clone progress ──────────────────────────────────────────────

export interface CodebaseStatusLike {
  id: string;
  alias: string;
  status?: string | null;
  lastError?: string | null;
}

export function isCloningStatus(status: string | null | undefined): boolean {
  return status === 'cloning' || status === 'pending';
}

/** Poll while any codebase is still cloning. */
export function anyCloning(codebases: readonly CodebaseStatusLike[] | undefined): boolean {
  return (codebases ?? []).some((c) => isCloningStatus(c.status));
}

export type CloneEvent =
  | { kind: 'ready'; id: string; alias: string }
  | { kind: 'failed'; id: string; alias: string; error: string };

/**
 * What changed between two polls: a codebase that WAS cloning and is now
 * ready or errored. A codebase first seen already in `error` produces no
 * event — that failure is not news, and the row already shows it.
 */
export function cloneEvents(
  previous: Readonly<Record<string, string | null | undefined>>,
  next: readonly CodebaseStatusLike[],
): CloneEvent[] {
  const events: CloneEvent[] = [];
  for (const codebase of next) {
    if (!isCloningStatus(previous[codebase.id])) continue;
    if (codebase.status === 'ready') {
      events.push({ kind: 'ready', id: codebase.id, alias: codebase.alias });
    } else if (codebase.status === 'error') {
      events.push({
        kind: 'failed',
        id: codebase.id,
        alias: codebase.alias,
        error: codebase.lastError?.trim() || 'The clone failed.',
      });
    }
  }
  return events;
}

export function statusSnapshot(codebases: readonly CodebaseStatusLike[]): Record<string, string | null> {
  return Object.fromEntries(codebases.map((c) => [c.id, c.status ?? null]));
}

// ── Project list ────────────────────────────────────────────────

export function isArchived(project: { status?: string | null }): boolean {
  return project.status === 'archived';
}

/** Active and archived, each keeping the input order. */
export function partitionProjects<T extends { status?: string | null }>(
  projects: readonly T[],
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const p of projects) (isArchived(p) ? archived : active).push(p);
  return { active, archived };
}

// ── Settings ────────────────────────────────────────────────────

export type WorktreeRetention = 'immediate' | 'hours-24' | 'hours-72' | 'manual';

export const RETENTION_OPTIONS: ReadonlyArray<{ value: WorktreeRetention; label: string; detail: string }> = [
  { value: 'immediate', label: 'Immediately', detail: 'Remove a worktree as soon as its run ends' },
  { value: 'hours-24', label: 'After 24 hours', detail: 'Keep finished worktrees for a day' },
  { value: 'hours-72', label: 'After 72 hours', detail: 'Keep finished worktrees for three days' },
  { value: 'manual', label: 'Manually', detail: 'Only remove worktrees when you clean up' },
];

export const DEFAULT_RETENTION: WorktreeRetention = 'hours-24';
export const DEFAULT_MAX_CODEBASES = 10;
export const MAX_CODEBASES_LIMIT = 50;

export interface ProjectSettingsDraft {
  name: string;
  description: string;
  worktreeRetention: WorktreeRetention;
  maxCodebases: number;
}

export function clampMaxCodebases(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CODEBASES;
  return Math.max(1, Math.min(MAX_CODEBASES_LIMIT, Math.round(value)));
}

function asRetention(value: unknown): WorktreeRetention {
  return RETENTION_OPTIONS.some((o) => o.value === value) ? (value as WorktreeRetention) : DEFAULT_RETENTION;
}

export function settingsDraftFrom(project: {
  name: string;
  description?: string | null;
  settings?: { worktreeRetention?: unknown; maxCodebases?: unknown } | null;
}): ProjectSettingsDraft {
  const max = project.settings?.maxCodebases;
  return {
    name: project.name,
    description: project.description ?? '',
    worktreeRetention: asRetention(project.settings?.worktreeRetention),
    maxCodebases: typeof max === 'number' ? clampMaxCodebases(max) : DEFAULT_MAX_CODEBASES,
  };
}

export interface ProjectUpdateBody {
  name?: string;
  description?: string;
  settings?: { worktreeRetention?: WorktreeRetention; maxCodebases?: number };
}

/**
 * The `PUT /projects/:id` body carrying only what changed, or null when
 * nothing did. `settings` is merged server-side, so a partial is safe. An
 * emptied name is ignored rather than sent (the server requires one).
 */
export function settingsPatch(saved: ProjectSettingsDraft, draft: ProjectSettingsDraft): ProjectUpdateBody | null {
  const body: ProjectUpdateBody = {};
  const name = draft.name.trim();
  if (name && name !== saved.name) body.name = name;
  const description = draft.description.trim();
  if (description !== saved.description.trim()) body.description = description;
  const settings: NonNullable<ProjectUpdateBody['settings']> = {};
  if (draft.worktreeRetention !== saved.worktreeRetention) settings.worktreeRetention = draft.worktreeRetention;
  const max = clampMaxCodebases(draft.maxCodebases);
  if (max !== saved.maxCodebases) settings.maxCodebases = max;
  if (Object.keys(settings).length > 0) body.settings = settings;
  return Object.keys(body).length > 0 ? body : null;
}

// ── Worktrees ───────────────────────────────────────────────────

export type WorktreeTone = 'neutral' | 'info' | 'warning' | 'success';

export function worktreeTone(status: string | null | undefined): WorktreeTone {
  if (status === 'active') return 'info';
  if (status === 'orphaned' || status === 'cleanup-pending') return 'warning';
  if (status === 'completed') return 'success';
  return 'neutral';
}

export function worktreeStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return 'In use';
    case 'completed':
      return 'Finished';
    case 'orphaned':
      return 'Orphaned';
    case 'cleanup-pending':
      return 'Cleanup pending';
    default:
      return status ? status : 'Unknown';
  }
}

/** A worktree an active run is using is not offered for removal. */
export function canRemoveWorktree(status: string | null | undefined): boolean {
  return status !== 'active';
}

/** `{ removed: 3 }`, `{ cleaned: [...] }`… → a one-line toast. */
export function cleanupSummary(result: unknown): string {
  const r = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  let count: number | null = null;
  for (const key of ['removed', 'cleaned', 'deleted', 'orphansRemoved', 'staleRecordsRemoved', 'count']) {
    const value = r[key];
    if (typeof value === 'number') count = (count ?? 0) + value;
    else if (Array.isArray(value)) count = (count ?? 0) + value.length;
  }
  if (count === null) return 'Cleanup finished.';
  if (count === 0) return 'Nothing to clean up.';
  return `Removed ${count} worktree${count === 1 ? '' : 's'}.`;
}

// ── File browser ────────────────────────────────────────────────

/** Forward slashes, no empty / `.` / `..` segments — never escapes the root. */
export function normalizeRelPath(path: string | null | undefined): string {
  return (path ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

export function parentPath(path: string): string {
  const parts = normalizeRelPath(path).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function breadcrumbs(path: string): Array<{ label: string; path: string }> {
  const parts = normalizeRelPath(path).split('/').filter(Boolean);
  const crumbs = [{ label: 'Root', path: '' }];
  parts.forEach((part, i) => crumbs.push({ label: part, path: parts.slice(0, i + 1).join('/') }));
  return crumbs;
}

export function formatBytes(size: number | null | undefined): string | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Directories first, then by name — the server already sorts; this is a guard. */
export function sortEntries<T extends { name: string; type: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export const FILE_PREVIEW_MAX_CHARS = 200_000;

export type FilePreview =
  | { kind: 'binary' }
  | { kind: 'empty' }
  | { kind: 'text'; text: string; truncated: boolean; lines: number };

/**
 * What the file viewer renders. A NUL character in the first 8K means
 * binary; very large text is cut so a phone does not lay out megabytes of
 * `Text`.
 */
export function filePreview(content: string | null | undefined, maxChars = FILE_PREVIEW_MAX_CHARS): FilePreview {
  const raw = content ?? '';
  if (!raw) return { kind: 'empty' };
  if (raw.slice(0, 8000).includes('\u0000')) return { kind: 'binary' };
  const truncated = raw.length > maxChars;
  const text = truncated ? raw.slice(0, maxChars) : raw;
  return { kind: 'text', text, truncated, lines: text.split('\n').length };
}

// ── MCP servers ─────────────────────────────────────────────────

export interface McpEntryLike {
  id?: string;
  name: string;
  description?: string;
  serverType?: 'http' | 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  source?: string;
  enabled?: boolean;
  userEnabled?: boolean;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  needsConfiguration?: { missingInputs?: string[]; missingCredentials?: string[] };
}

/** The switch position: the user's own toggle, not "on AND fully configured". */
export function mcpSwitchValue(entry: McpEntryLike): boolean {
  return entry.userEnabled ?? entry.enabled ?? true;
}

export function mcpNeedsConfiguration(entry: McpEntryLike): boolean {
  const n = entry.needsConfiguration;
  return Boolean(n && ((n.missingInputs?.length ?? 0) > 0 || (n.missingCredentials?.length ?? 0) > 0));
}

/**
 * Full-replacement body for `PUT /projects/:id/mcp-servers/:mid` and
 * `PUT /system/mcp-servers/custom/:id` that only flips `enabled`.
 *
 * Both routes treat the body as the COMPLETE desired server, credentials
 * included: a stored credential name left out is deleted. Echoing the
 * redacted `headers`/`env` maps from the GET keeps every stored value, so a
 * toggle can never wipe a token.
 */
export function mcpToggleBody(entry: McpEntryLike, enabled: boolean): Record<string, unknown> {
  const serverType = entry.serverType ?? (entry.command ? 'stdio' : 'http');
  const headers = entry.headers && Object.keys(entry.headers).length ? entry.headers : null;
  const env = entry.env && Object.keys(entry.env).length ? entry.env : null;
  return {
    name: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
    serverType,
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.command ? { command: entry.command } : {}),
    ...(entry.args ? { args: entry.args } : {}),
    ...(entry.timeoutMs ? { timeoutMs: entry.timeoutMs } : {}),
    enabled,
    ...(serverType !== 'stdio' && headers ? { headers } : {}),
    ...(serverType === 'stdio' && env ? { env } : {}),
  };
}

/**
 * Which route flips a global server. Bundled (`system`) servers take a
 * prefs patch; `custom` ones take the full replacement body. Anything else
 * (a project server listed globally) is not toggleable from Settings.
 */
export function globalMcpToggle(
  entry: McpEntryLike,
  enabled: boolean,
): { path: string; body: Record<string, unknown> } | null {
  if (!entry.id) return null;
  const id = encodeURIComponent(entry.id);
  if (entry.source === 'system') return { path: `/api/system/mcp-servers/system/${id}`, body: { enabled } };
  if (entry.source === 'custom') return { path: `/api/system/mcp-servers/custom/${id}`, body: mcpToggleBody(entry, enabled) };
  return null;
}

export function mcpSubtitle(entry: McpEntryLike): string | null {
  if (entry.description) return entry.description;
  if (entry.url) return entry.url;
  if (entry.command) return [entry.command, ...(entry.args ?? [])].join(' ');
  return null;
}

// ── Artifacts (project configs) ─────────────────────────────────

export type ArtifactKind = 'skill' | 'prompt' | 'agent' | 'mcp';

export function configsOfKind<T extends { type: string }>(configs: readonly T[] | undefined, kind: ArtifactKind): T[] {
  return (configs ?? []).filter((c) => c.type === kind);
}

export function artifactKindLabel(kind: ArtifactKind, count?: number): string {
  const singular = { skill: 'skill', prompt: 'prompt', agent: 'agent', mcp: 'MCP server' }[kind];
  if (count === undefined) return singular;
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

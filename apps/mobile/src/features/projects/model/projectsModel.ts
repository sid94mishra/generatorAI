// Projects rules (MProjects … MSkillDetail; 04 §2.6; M7-02). Pure, unit-tested: names and repository URLs, codebase
// drafts and the create / link bodies, retention, the settings patch, rows and menus, codebase locations and state,
// worktree filters and clean-up, the customization merge (G-19) and the fetch-log progress (G-16).
import type {
  CodebaseLogLine,
  CodebaseStatus,
  CodebaseType,
  ConfigType,
  ProjectArtifactPrefEntry,
  WorktreeListItem,
  WorktreeRetentionPolicy,
} from '@generatorai/shared';
import { HEALTH } from '@generatorai/shared';

// ── Names and repository URLs ───────────────────────────────────

export const PROJECT_NAME_MAX = 120;

export function validateProjectName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the project a name.';
  if (trimmed.length > PROJECT_NAME_MAX) return `Keep the name under ${PROJECT_NAME_MAX} characters.`;
  return null;
}

/** `owner/repo` from an https, ssh:// or scp-style (`git@host:owner/repo.git`) URL. */
export function repoSlugFromUrl(url: string): string | null {
  const raw = url.trim().replace(/[\\/]+$/, '');
  if (!raw) return null;
  let path: string | null = null;
  const scp = /^[^@\s/]+@[^:\s/]+:(.+)$/.exec(raw);
  if (scp) path = scp[1]!;
  else {
    const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/?(.*)$/i.exec(raw);
    if (scheme) path = scheme[1] ?? '';
  }
  if (path === null) return null;
  const parts = path.replace(/\.git$/i, '').split('/').filter(Boolean);
  return parts.length ? parts.slice(-2).join('/') : null;
}

/** A remote the server can clone: `https://…`, `ssh://…`, `git://…` or `git@host:owner/repo`. */
export function validateGitUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return 'Paste the repository URL.';
  if (/\s/.test(raw)) return 'A repository URL cannot contain spaces.';
  const scheme = /^(https?|ssh|git):\/\/[^/\s]+\/.+/i.test(raw);
  const scp = /^[^@\s/]+@[^:\s/]+:\S+$/.test(raw);
  if (!scheme && !scp) return 'Use an https:// or git@host:owner/repo URL.';
  if (!repoSlugFromUrl(raw)) return 'That URL has no repository path.';
  return null;
}

function lastSegment(path: string): string {
  const parts = path.trim().replace(/[\\/]+$/, '').split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function aliasFrom(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The default alias: the repository name, or the folder name for a server path. */
export function defaultAlias(kind: CodebaseType, location: string): string {
  if (kind === 'git-remote') return aliasFrom(repoSlugFromUrl(location)?.split('/').pop() ?? '');
  return aliasFrom(lastSegment(location));
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

// ── Codebase drafts (MProjectCreate, MAddCodebase) ──────────────

export const CODEBASE_KINDS: ReadonlyArray<{ value: CodebaseType; label: string; hint: string }> = [
  { value: 'git-remote', label: 'Git remote', hint: 'Cloned into the project root; Fetch keeps it current.' },
  { value: 'git-local', label: 'Local git', hint: 'A repository on the server, used in place; worktrees branch from it.' },
  { value: 'local-dir', label: 'Local folder', hint: 'A folder on the server, read in place (no git history).' },
];

export interface CodebaseDraft {
  kind: CodebaseType;
  /** URL for a remote, server path otherwise. */
  location: string;
  alias: string;
  branch: string;
  subdirectory: string;
}

export const EMPTY_CODEBASE_DRAFT: CodebaseDraft = { kind: 'git-remote', location: '', alias: '', branch: '', subdirectory: '' };

export function codebaseDraftError(draft: CodebaseDraft): string | null {
  if (draft.kind === 'git-remote') return validateGitUrl(draft.location);
  if (!draft.location.trim()) return 'Choose a folder on the server.';
  return null;
}

export interface CodebaseLinkBody {
  alias: string;
  type: CodebaseType;
  url?: string;
  localPath?: string;
  defaultBranch?: string;
  subdirectory?: string;
}

/** The `POST /projects/:id/codebases` body; the alias defaults to the repository / folder name, unique in the project. */
export function codebaseBody(draft: CodebaseDraft, taken: Iterable<string> = []): CodebaseLinkBody {
  const location = draft.location.trim();
  const alias = uniqueAlias(draft.alias.trim() || defaultAlias(draft.kind, location) || 'repo', taken);
  const branch = draft.branch.trim();
  const sub = draft.subdirectory.trim();
  return {
    alias,
    type: draft.kind,
    ...(draft.kind === 'git-remote' ? { url: location } : { localPath: location }),
    ...(branch && draft.kind !== 'local-dir' ? { defaultBranch: branch } : {}),
    ...(sub ? { subdirectory: sub } : {}),
  };
}

/** Bodies for a set of drafts, aliases unique among themselves and `existing`. */
export function codebaseBodies(drafts: readonly CodebaseDraft[], existing: Iterable<string> = []): CodebaseLinkBody[] {
  const taken = new Set(existing);
  return drafts.map((draft) => {
    const body = codebaseBody(draft, taken);
    taken.add(body.alias);
    return body;
  });
}

// ── Retention and settings ──────────────────────────────────────

export const RETENTION_OPTIONS: ReadonlyArray<{ value: WorktreeRetentionPolicy; short: string; label: string; hint: string }> = [
  { value: 'immediate', short: 'Immediate', label: 'Remove immediately', hint: 'Completed worktrees are removed as soon as their chat or run ends.' },
  { value: 'hours-24', short: '24 h', label: 'Keep for 24 hours', hint: 'Completed worktrees are removed 24 h after their chat or run ends.' },
  { value: 'hours-72', short: '72 h', label: 'Keep for 72 hours', hint: 'Completed worktrees are removed 72 h after their chat or run ends.' },
  { value: 'manual', short: 'Manual', label: 'Keep until removed', hint: 'Completed worktrees stay until you clean them up.' },
];

export const DEFAULT_RETENTION: WorktreeRetentionPolicy = 'hours-24';
export const DEFAULT_MAX_CODEBASES = 10;
export const MAX_CODEBASES_LIMIT = 50;

export function retentionOf(value: unknown): WorktreeRetentionPolicy {
  return RETENTION_OPTIONS.some((o) => o.value === value) ? (value as WorktreeRetentionPolicy) : DEFAULT_RETENTION;
}

export function retentionShort(value: unknown): string {
  return RETENTION_OPTIONS.find((o) => o.value === retentionOf(value))!.short;
}

export function clampMaxCodebases(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CODEBASES;
  return Math.max(1, Math.min(MAX_CODEBASES_LIMIT, Math.round(value)));
}

export interface ProjectSettingsDraft {
  worktreeRetention: WorktreeRetentionPolicy;
  maxCodebases: number;
}

export function settingsDraftFrom(project: { settings?: { worktreeRetention?: unknown; maxCodebases?: unknown } | null }): ProjectSettingsDraft {
  const max = project.settings?.maxCodebases;
  return {
    worktreeRetention: retentionOf(project.settings?.worktreeRetention),
    maxCodebases: typeof max === 'number' ? clampMaxCodebases(max) : DEFAULT_MAX_CODEBASES,
  };
}

/** The `PUT /projects/:id` settings partial (merged server-side), or null when nothing changed. */
export function settingsPatch(saved: ProjectSettingsDraft, draft: ProjectSettingsDraft): { settings: Partial<ProjectSettingsDraft> } | null {
  const settings: Partial<ProjectSettingsDraft> = {};
  if (draft.worktreeRetention !== saved.worktreeRetention) settings.worktreeRetention = draft.worktreeRetention;
  const max = clampMaxCodebases(draft.maxCodebases);
  if (max !== saved.maxCodebases) settings.maxCodebases = max;
  return Object.keys(settings).length ? { settings } : null;
}

export function settingsChangeCount(saved: ProjectSettingsDraft, draft: ProjectSettingsDraft): number {
  return Object.keys(settingsPatch(saved, draft)?.settings ?? {}).length;
}

// ── Project list ────────────────────────────────────────────────

export type ProjectScope = 'active' | 'archived';

export function isArchived(project: { status?: string | null }): boolean {
  return project.status === 'archived';
}

export function filterProjects<T extends { name: string; description?: string; status?: string | null }>(projects: readonly T[], scope: ProjectScope, query: string): T[] {
  const q = query.trim().toLowerCase();
  return projects.filter(
    (p) => (scope === 'archived') === isArchived(p) && (!q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)),
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Row counts "2 codebases · 3 chats" (absent summary fields are left out, never 0 — G-13). */
export function projectCounts(summary: { codebases?: number; activeChats?: number } | undefined): string[] {
  if (!summary) return [];
  return [
    ...(summary.codebases !== undefined ? [plural(summary.codebases, 'codebase')] : []),
    ...(summary.activeChats !== undefined ? [plural(summary.activeChats, 'chat')] : []),
  ];
}

export type ProjectMenuId = 'open' | 'new-chat' | 'run-workflow' | 'add-codebase' | 'copy-path' | 'settings' | 'archive' | 'unarchive' | 'delete';

/** MProjects long-press menu (04 §2.6); authoring items need `write:projects`. */
export function projectMenu(project: { status?: string | null; rootPath?: string }, canEdit: boolean): Array<{ id: ProjectMenuId; label: string; icon: string; destructive?: boolean } | { type: 'separator' }> {
  const archived = isArchived(project);
  return [
    { id: 'open', label: 'Open', icon: 'external-link' },
    { id: 'new-chat', label: 'New chat', icon: 'edit' },
    { id: 'run-workflow', label: 'Run workflow…', icon: 'play' },
    ...(canEdit && !archived ? [{ id: 'add-codebase' as const, label: 'Add codebase…', icon: 'plus' }] : []),
    { type: 'separator' as const },
    ...(project.rootPath ? [{ id: 'copy-path' as const, label: 'Copy root path', icon: 'copy' }] : []),
    { id: 'settings', label: 'Settings', icon: 'settings' },
    ...(canEdit
      ? [
          { type: 'separator' as const },
          archived ? { id: 'unarchive' as const, label: 'Unarchive', icon: 'archive' } : { id: 'archive' as const, label: 'Archive', icon: 'archive' },
          { id: 'delete' as const, label: 'Delete…', icon: 'trash', destructive: true },
        ]
      : []),
  ];
}

// ── Detail tabs (R-3) ───────────────────────────────────────────

export const PROJECT_TABS = ['codebases', 'chats', 'runs', 'pull-requests', 'customization', 'settings'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];
export const PROJECT_TAB_LABEL: Record<ProjectTab, string> = {
  codebases: 'Codebases',
  chats: 'Chats',
  runs: 'Runs',
  'pull-requests': 'Pull requests',
  customization: 'Customization',
  settings: 'Settings',
};

export function projectTab(param: string | undefined | null): ProjectTab {
  return (PROJECT_TABS as readonly string[]).includes(param ?? '') ? (param as ProjectTab) : 'codebases';
}

// ── Codebases ───────────────────────────────────────────────────

export function codebaseTypeLabel(type: string | undefined): string {
  return CODEBASE_KINDS.find((k) => k.value === type)?.label ?? 'Codebase';
}

/** The mono location line: the remote URL without its scheme, or the server path. */
export function codebaseLocation(codebase: { type?: string; url?: string | null; localPath?: string | null }): string {
  const url = codebase.url?.trim();
  if (url && codebase.type === 'git-remote') return url.replace(/^[a-z]+:\/\//i, '').replace(/\.git$/i, '');
  return codebase.localPath?.trim() || url || '';
}

export function codebaseHealth(status: string | null | undefined): { tone: (typeof HEALTH.codebase)[CodebaseStatus]['tone']; label: string; busy: boolean } {
  const known = status && status in HEALTH.codebase ? HEALTH.codebase[status as CodebaseStatus] : null;
  return { tone: known?.tone ?? 'idle', label: known?.label ?? (status || 'Unknown'), busy: status === 'cloning' || status === 'pending' };
}

/** Poll while any codebase is still cloning. */
export function anyCloning(codebases: ReadonlyArray<{ status?: string | null }> | undefined): boolean {
  return (codebases ?? []).some((c) => c.status === 'cloning' || c.status === 'pending');
}

// ── Worktrees (G-17) ────────────────────────────────────────────

export type WorktreeFilter = 'all' | 'active' | 'orphaned' | 'completed';

export function worktreeStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'completed':
      return 'Completed';
    case 'orphaned':
      return 'Orphaned';
    case 'cleanup-pending':
      return 'Cleaning up';
    default:
      return status || 'Unknown';
  }
}

export function filterWorktrees<T extends { status: string }>(items: readonly T[], filter: WorktreeFilter): T[] {
  return filter === 'all' ? [...items] : items.filter((w) => w.status === filter);
}

export function worktreeCounts(items: ReadonlyArray<{ status: string }>): Record<WorktreeFilter, number> {
  return {
    all: items.length,
    active: items.filter((w) => w.status === 'active').length,
    orphaned: items.filter((w) => w.status === 'orphaned').length,
    completed: items.filter((w) => w.status === 'completed').length,
  };
}

/** A worktree an active chat or run is using is not offered for removal. */
export function canRemoveWorktree(status: string | null | undefined): boolean {
  return status !== 'active' && status !== 'cleanup-pending';
}

/** What "Clean up orphans" removes, and the bytes it frees when every size is known. */
export function orphanCleanup(items: readonly WorktreeListItem[]): { items: WorktreeListItem[]; bytes: number | null } {
  const orphans = items.filter((w) => w.status === 'orphaned');
  const sizes = orphans.map((w) => w.sizeBytes);
  const bytes = sizes.length && sizes.every((s): s is number => typeof s === 'number') ? sizes.reduce((a, b) => a + b, 0) : null;
  return { items: orphans, bytes };
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
  if (count === null) return 'Clean-up finished.';
  if (count === 0) return 'Nothing to clean up.';
  return `Removed ${plural(count, 'worktree')}.`;
}

// ── Customization (G-19) ────────────────────────────────────────

export type ArtifactKind = 'skill' | 'prompt' | 'agent';
export type CustomizationKind = ArtifactKind | 'mcp';
export const CUSTOMIZATION_KINDS: readonly CustomizationKind[] = ['skill', 'prompt', 'agent', 'mcp'];
export const KIND_PARAM: Record<CustomizationKind, string> = { skill: 'skills', prompt: 'prompts', agent: 'agents', mcp: 'mcp' };
export const KIND_LABEL: Record<CustomizationKind, string> = { skill: 'Skills', prompt: 'Prompts', agent: 'Agents', mcp: 'MCP' };
export const KIND_SINGULAR: Record<CustomizationKind, string> = { skill: 'skill', prompt: 'prompt', agent: 'agent', mcp: 'MCP server' };

export function kindFromParam(param: string | null | undefined): CustomizationKind {
  return CUSTOMIZATION_KINDS.find((k) => KIND_PARAM[k] === param) ?? 'skill';
}

export interface ArtifactLike {
  id: string;
  type: string;
  name: string;
  description?: string;
}

export interface CustomizationItem {
  id: string;
  type: ConfigType;
  name: string;
  description?: string;
  source: 'system' | 'project';
}

/**
 * System + project artifacts of one kind, project entries shadowing a system one with the same name — rebuilt from
 * the unfiltered lists because `/available-artifacts` drops the ones this project switched off (G-19).
 */
export function mergeArtifacts(system: readonly ArtifactLike[], project: readonly ArtifactLike[], kind: CustomizationKind): CustomizationItem[] {
  const byName = new Map<string, CustomizationItem>();
  const add = (a: ArtifactLike, source: 'system' | 'project'): void => {
    if (a.type !== kind) return;
    byName.set(a.name.toLowerCase(), { id: a.id, type: kind, name: a.name, ...(a.description ? { description: a.description } : {}), source });
  };
  for (const s of system) add(s, 'system');
  for (const p of project) add(p, 'project');
  return [...byName.values()].sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'project' ? -1 : 1));
}

export const prefKey = (type: ConfigType, id: string): string => `${type}:${id}`;

/** The disabled set after switching one entry on or off (the PUT replaces the whole set). */
export function toggleDisabled(disabled: readonly ProjectArtifactPrefEntry[], type: ConfigType, id: string, enabled: boolean): ProjectArtifactPrefEntry[] {
  const rest = disabled.filter((d) => !(d.type === type && d.id === id));
  return enabled ? rest : [...rest, { type, id }];
}

// ── Fetch logs (G-16) ───────────────────────────────────────────

/** The newest git progress line's percent ("Receiving objects:  38% (694/1824)") and its phrase, when there is one. */
export function logProgress(lines: readonly CodebaseLogLine[]): { percent: number; phase: string } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const segments = lines[i]!.text.split('\r');
    for (let j = segments.length - 1; j >= 0; j--) {
      const m = /([A-Za-z][A-Za-z ]+objects):\s+(\d{1,3})%\s*(\(\d+\/\d+\))?/.exec(segments[j]!);
      if (m) return { percent: Math.min(100, Number(m[2])), phase: `${m[1]!.trim()}${m[3] ? ` · ${m[3].slice(1, -1).replace('/', ' / ')}` : ''}` };
    }
  }
  return null;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** "14:06:02" for a log line. */
export function logTime(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : timeFormat.format(t);
}

// ── Uploads (MProjectCustomization) ─────────────────────────────

/** `name:` / `description:` of a markdown file's YAML frontmatter (plain scalars only). */
export function frontmatterField(text: string, field: string): string | undefined {
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return undefined;
  const line = new RegExp(`^${field}:\\s*(.+)$`, 'm').exec(fm[1]!);
  const value = line?.[1]?.trim().replace(/^["']|["']$/g, '');
  return value || undefined;
}

/**
 * Where an uploaded file lands: a skill is a folder holding SKILL.md (named from its frontmatter, else the file); a
 * prompt or agent keeps its file name. Names are folder-safe.
 */
export function uploadPlan(kind: ArtifactKind, fileName: string, text: string): { name: string; filePath: string; description?: string } {
  const base = fileName.replace(/\.[^.]+$/, '');
  const raw = frontmatterField(text, 'name') ?? (kind === 'skill' && /^skill$/i.test(base) ? 'skill' : base);
  const name = raw.trim().replace(/[\\/]+/g, '-').slice(0, 120) || 'untitled';
  const description = frontmatterField(text, 'description');
  const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
  const filePath = kind === 'skill' ? `${safe}/SKILL.md` : fileName.replace(/[\\/]+/g, '-');
  return { name, filePath, ...(description ? { description } : {}) };
}

// ── Codebase files ──────────────────────────────────────────────

/** A codebase file's `{content}` as FileContentView input: binary when a NUL shows in the first 8 KB. */
export function codebaseFileContent(content: string | null | undefined): { contents: string | null; size: number; isBinary: boolean } {
  const text = content ?? '';
  return { contents: text, size: new TextEncoder().encode(text).length, isBinary: text.slice(0, 8000).includes('\u0000') };
}

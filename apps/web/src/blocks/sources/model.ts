// ────────────────────────────────────────────────────────────────
// sourceModel — the editable shape of "what this chat works on"
// ────────────────────────────────────────────────────────────────
//
// A chat's workspace is a managed scratch root plus an ordered list of
// MOUNTS: project codebases and local folders, each edited in place or
// through a git worktree, optionally on a branch of its own. The server
// takes that plan as `ChatSourceSpec[]` (create) or `PUT /chats/:id/sources`
// (edit).
//
// This file is the pure half of the picker: drafts in, specs out. It is
// deliberately free of React and of the network so the mapping — which is
// where the real bugs live (aliases colliding, a default branch name that
// does not match the placeholder the user was shown) — can be unit-tested.

import type { ChatSourceSpec, WorkspaceMount } from '@generatorai/shared';

/** How a source is materialised. `generated` is server-side only. */
export type SourceMode = 'in-place' | 'worktree';

/**
 * Which branch the mount ends up on.
 *   current  — leave the repository on whatever it already has checked out
 *   existing — check out (or cut the worktree from) a branch that exists
 *   new      — create a branch, from `baseRef`
 */
export type BranchMode = 'current' | 'existing' | 'new';

/** Capabilities + display facts about a source. Never sent to the server. */
export interface DraftMeta {
  /** Codebase alias, or the folder's basename. */
  label: string;
  /** Full origin path / URL, shown truncated with the full value on hover. */
  origin?: string;
  isGit: boolean;
  /**
   * A bare clone (git-remote codebase) has no working tree to edit in place;
   * `reason` explains that on the disabled control.
   */
  allowInPlace: boolean;
  allowInPlaceReason?: string;
  /** A plain folder (or a local-dir codebase) cannot be worktree'd. */
  allowWorktree: boolean;
  allowWorktreeReason?: string;
  defaultBranch?: string;
  branches: string[];
  /** Uncommitted changes — switching branches will be refused until clean. */
  dirty?: boolean;
  nestedRepos?: string[];
  /** Git facts are still being fetched (folders only). */
  loading?: boolean;
  /** Why this source cannot be used at all (e.g. the folder went away). */
  error?: string;
}

/** One row of the picker. */
export interface DraftSource {
  /** Stable React key; not part of the payload. */
  key: string;
  kind: 'codebase' | 'folder';
  codebaseId?: string;
  /** Absolute path, for `kind: 'folder'`. */
  path?: string;
  alias: string;
  mode: SourceMode;
  branchMode: BranchMode;
  /** Empty means "use the placeholder", i.e. `generatorai/<chat-slug>`. */
  newBranch: string;
  /** Selected existing branch (branchMode `existing`). */
  branch: string;
  /** What a new branch is cut from (branchMode `new`). */
  baseRef: string;
  meta: DraftMeta;
}

const ALIAS_OK = /^[A-Za-z0-9._-]+$/;

/** Lowercase, hyphenated, git-ref-safe slug of a chat name. */
export function slugifyChatName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'chat';
}

/** The branch name offered as a placeholder for a fresh worktree. */
export function defaultNewBranch(chatName: string): string {
  return `generatorai/${slugifyChatName(chatName)}`;
}

/** Last path segment of an absolute path, on either platform's separators. */
export function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  const last = parts[parts.length - 1] ?? '';
  // `C:\` has no segment of its own; name it after the drive letter.
  return last.replace(/:$/, '') || 'folder';
}

/** Coerce arbitrary text into something the server's alias rule accepts. */
export function sanitizeAlias(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 64);
  return cleaned || 'source';
}

/** `frontend`, `frontend-2`, `frontend-3`, … */
export function uniqueAlias(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const seed = sanitizeAlias(base);
  if (!used.has(seed)) return seed;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${seed}-${String(n)}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${seed}-${String(Date.now())}`;
}

/** The branch a draft will actually end up on, for summaries and previews. */
export function effectiveBranch(draft: DraftSource, chatName: string): string | null {
  if (draft.branchMode === 'new') return draft.newBranch.trim() || defaultNewBranch(chatName);
  if (draft.branchMode === 'existing') return draft.branch || null;
  return draft.meta.defaultBranch ?? null;
}

/**
 * Drafts → the payload. One spec per draft, in order; `sources[0]` is the
 * agent's cwd unless `primary` names another alias.
 */
export function draftsToSources(drafts: DraftSource[], chatName: string): ChatSourceSpec[] {
  return drafts.map((d) => {
    const common: {
      mode: SourceMode;
      alias: string;
      branch?: string;
      newBranch?: string;
      baseRef?: string;
    } = { mode: d.mode, alias: d.alias };
    if (d.branchMode === 'new') {
      common.newBranch = d.newBranch.trim() || defaultNewBranch(chatName);
      const base = d.baseRef.trim();
      if (base) common.baseRef = base;
    } else if (d.branchMode === 'existing' && d.branch.trim()) {
      common.branch = d.branch.trim();
    }
    return d.kind === 'codebase'
      ? ({ kind: 'codebase', codebaseId: d.codebaseId ?? '', ...common } as ChatSourceSpec)
      : ({ kind: 'folder', path: d.path ?? '', ...common } as ChatSourceSpec);
  });
}

/** `frontend → worktree on generatorai/cart-fix from main` */
export function describeDraft(draft: DraftSource, chatName: string): string {
  const mode = draft.mode === 'worktree' ? 'worktree' : 'in place';
  const branch = effectiveBranch(draft, chatName);
  if (!branch) return `${draft.alias} → ${mode}`;
  const base =
    draft.branchMode === 'new' && draft.baseRef.trim() ? ` from ${draft.baseRef.trim()}` : '';
  return `${draft.alias} → ${mode} on ${branch}${base}`;
}

/** The one-line summary shown under the source list. */
export function sourcesSummary(drafts: DraftSource[], chatName: string): string {
  return drafts.map((d) => describeDraft(d, chatName)).join(' · ');
}

/**
 * Everything the client can reject before the round trip. Server-side
 * validation (the folder exists, the branch is real, the repo is clean) still
 * has the last word and is surfaced inline from its 400.
 */
export function validateDrafts(drafts: DraftSource[]): string | null {
  const seen = new Set<string>();
  for (const d of drafts) {
    if (!d.alias.trim()) return 'Every source needs a name.';
    if (!ALIAS_OK.test(d.alias)) {
      return `"${d.alias}" is not a valid name — use letters, digits, dot, dash or underscore.`;
    }
    if (seen.has(d.alias)) return `Two sources are both called "${d.alias}".`;
    seen.add(d.alias);
    if (d.kind === 'folder' && !d.path?.trim()) return 'Pick a folder for every local source.';
    if (d.kind === 'codebase' && !d.codebaseId) return 'A codebase source is missing its codebase.';
    if (d.meta.error) return `${d.alias}: ${d.meta.error}`;
    if (d.mode === 'worktree' && !d.meta.allowWorktree) {
      return `${d.alias} cannot use a worktree — it is not a git repository.`;
    }
    if (d.mode === 'in-place' && !d.meta.allowInPlace) {
      return `${d.alias} cannot be edited in place.`;
    }
    if (d.branchMode === 'new' && d.newBranch.trim() && /[\s~^:?*[\]\\]/.test(d.newBranch.trim())) {
      return `"${d.newBranch.trim()}" is not a valid branch name.`;
    }
    if (d.branchMode === 'existing' && !d.branch.trim()) {
      return `Choose a branch for ${d.alias}, or leave it on its current one.`;
    }
  }
  return null;
}

// ── Constructors ────────────────────────────────────────────────

export interface CodebaseLike {
  id: string;
  alias: string;
  type: string;
  url?: string | undefined;
  localPath?: string | undefined;
  defaultBranch?: string | undefined;
  status?: string;
}

/** A codebase row the user just ticked. */
export function draftFromCodebase(
  cb: CodebaseLike,
  taken: Iterable<string>,
  branches: string[] = [],
): DraftSource {
  // A git-remote codebase is cloned bare; there is no working tree to edit,
  // so a worktree is the only way to give the agent files.
  const isRemote = cb.type === 'git-remote';
  const isLocalDir = cb.type === 'local-dir';
  return {
    key: `cb:${cb.id}`,
    kind: 'codebase',
    codebaseId: cb.id,
    alias: uniqueAlias(cb.alias, taken),
    mode: isLocalDir ? 'in-place' : 'worktree',
    branchMode: isLocalDir ? 'current' : 'new',
    newBranch: '',
    branch: '',
    baseRef: cb.defaultBranch ?? '',
    meta: {
      label: cb.alias,
      ...(cb.url ?? cb.localPath ? { origin: cb.url ?? cb.localPath ?? '' } : {}),
      isGit: !isLocalDir,
      allowInPlace: !isRemote,
      ...(isRemote
        ? { allowInPlaceReason: 'This codebase is a bare clone of a remote — there is no checkout to edit in place.' }
        : {}),
      allowWorktree: !isLocalDir,
      ...(isLocalDir
        ? { allowWorktreeReason: 'This codebase is a plain directory, not a git repository.' }
        : {}),
      ...(cb.defaultBranch ? { defaultBranch: cb.defaultBranch } : {}),
      branches,
    },
  };
}

export interface FolderGitInfo {
  isRepo: boolean;
  currentBranch: string | null;
  branches: string[];
  dirty: boolean;
  nestedRepos: string[];
}

/** A local folder the user just picked. */
export function draftFromFolder(
  path: string,
  info: FolderGitInfo | undefined,
  taken: Iterable<string>,
): DraftSource {
  const isGit = info?.isRepo === true;
  return {
    key: `folder:${path}`,
    kind: 'folder',
    path,
    alias: uniqueAlias(basename(path), taken),
    // In place is the default: the user pointed at a folder because they want
    // the agent to work in THAT folder.
    mode: 'in-place',
    branchMode: 'current',
    newBranch: '',
    branch: '',
    baseRef: info?.currentBranch ?? '',
    meta: {
      label: basename(path),
      origin: path,
      isGit,
      allowInPlace: true,
      allowWorktree: isGit,
      ...(isGit ? {} : { allowWorktreeReason: 'This folder is not a git repository.' }),
      ...(info?.currentBranch ? { defaultBranch: info.currentBranch } : {}),
      branches: info?.branches ?? [],
      ...(info ? { dirty: info.dirty, nestedRepos: info.nestedRepos } : { loading: true }),
    },
  };
}

// ── Prefill (editing an existing chat) ──────────────────────────

/**
 * `chat.sources` → drafts, enriched with whatever the workspace's mounts
 * already know (real branch, dirty flag, nested repos).
 *
 * Falls back to the mounts alone for chats created before `sources` existed,
 * so "Edit sources…" is never an empty form on a working chat.
 */
export function draftsFromSpecs(
  specs: readonly ChatSourceSpec[] | undefined,
  ctx: {
    codebases?: readonly CodebaseLike[];
    mounts?: readonly WorkspaceMount[];
    branchesByCodebaseId?: Record<string, string[]>;
  } = {},
): DraftSource[] {
  const mountByAlias = new Map((ctx.mounts ?? []).map((m) => [m.alias, m]));
  const byId = new Map((ctx.codebases ?? []).map((c) => [c.id, c]));

  if (!specs || specs.length === 0) {
    return (ctx.mounts ?? [])
      .filter((m) => m.status !== 'removed' && m.mode !== 'generated')
      .map((m) => draftFromMount(m, byId));
  }

  return specs.map((spec, i) => {
    const alias =
      spec.alias ??
      (spec.kind === 'codebase'
        ? (byId.get(spec.codebaseId)?.alias ?? `source-${String(i + 1)}`)
        : basename(spec.path));
    const mount = mountByAlias.get(alias);
    const codebase = spec.kind === 'codebase' ? byId.get(spec.codebaseId) : undefined;
    const base: DraftSource =
      spec.kind === 'codebase'
        ? draftFromCodebase(
            codebase ?? { id: spec.codebaseId, alias, type: 'git-remote' },
            [],
            ctx.branchesByCodebaseId?.[spec.codebaseId] ?? [],
          )
        : draftFromFolder(
            spec.path,
            mount?.git
              ? {
                  isRepo: mount.git.isRepo,
                  currentBranch: mount.git.branch ?? null,
                  branches: mount.git.branch ? [mount.git.branch] : [],
                  dirty: mount.hasUncommittedChanges,
                  nestedRepos: mount.git.nested ?? [],
                }
              : { isRepo: false, currentBranch: null, branches: [], dirty: false, nestedRepos: [] },
            [],
          );

    const branchMode: BranchMode = spec.newBranch
      ? 'new'
      : spec.branch
        ? 'existing'
        : 'current';

    /**
     * A saved plan is evidence in itself.
     *
     * The catalogue of codebases and the workspace's mounts both arrive
     * asynchronously; until they do we know nothing about this source except
     * what the plan says. Judging it against invented defaults would reject a
     * plan the server accepted five minutes ago ("cannot be edited in place")
     * purely because a query had not resolved — so an unverified source is
     * allowed to keep doing whatever it was already doing.
     */
    const unverified = spec.kind === 'codebase' ? !codebase : !mount;
    const capabilities = unverified
      ? { allowInPlace: true, allowWorktree: true }
      : {
          allowInPlace: base.meta.allowInPlace,
          allowWorktree: base.meta.allowWorktree || spec.mode === 'worktree',
        };

    return {
      ...base,
      key: `${spec.kind}:${alias}:${String(i)}`,
      alias,
      mode: spec.mode ?? base.mode,
      branchMode,
      newBranch: spec.newBranch ?? '',
      branch: spec.branch ?? '',
      baseRef: spec.baseRef ?? base.baseRef,
      meta: {
        ...base.meta,
        ...capabilities,
        ...(mount?.git?.branch ? { defaultBranch: mount.git.branch } : {}),
        ...(mount ? { dirty: mount.hasUncommittedChanges } : {}),
        ...(mount?.git?.nested ? { nestedRepos: mount.git.nested } : {}),
      },
    };
  });
}

function draftFromMount(mount: WorkspaceMount, byId: Map<string, CodebaseLike>): DraftSource {
  const cb = mount.codebaseId ? byId.get(mount.codebaseId) : undefined;
  const isGit = mount.git?.isRepo === true;
  return {
    key: `mount:${mount.id}`,
    kind: mount.originKind === 'codebase' ? 'codebase' : 'folder',
    ...(mount.codebaseId ? { codebaseId: mount.codebaseId } : {}),
    ...(mount.originKind === 'codebase' ? {} : { path: mount.originPath ?? mount.path }),
    alias: mount.alias,
    mode: mount.mode === 'worktree' ? 'worktree' : 'in-place',
    branchMode: 'current',
    newBranch: '',
    branch: '',
    baseRef: mount.git?.baseRef ?? '',
    meta: {
      label: cb?.alias ?? mount.alias,
      origin: mount.originPath ?? mount.path,
      isGit,
      allowInPlace: cb?.type !== 'git-remote',
      allowWorktree: isGit,
      ...(mount.git?.branch ? { defaultBranch: mount.git.branch } : {}),
      branches: mount.git?.branch ? [mount.git.branch] : [],
      dirty: mount.hasUncommittedChanges,
      ...(mount.git?.nested ? { nestedRepos: mount.git.nested } : {}),
    },
  };
}

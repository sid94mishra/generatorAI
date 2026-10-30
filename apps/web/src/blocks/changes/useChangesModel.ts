// ────────────────────────────────────────────────────────────────
// useChangesModel — what the Changes panel is showing, derived from the
// summary-first API.
//
//   summary (GET /changes) → file list, per-mount revisions, mount groups,
//   tree paths/statuses, the compare picker's choices (compareChoices.ts).
//
// File bodies are fetched lazily per expanded row (useDiffSources); this
// hook never touches them.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from 'react';
import { useWorkspaceChangeSummary, useWorkspaceCheckpoints } from '@/hooks/queries.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import type { ChangeStatus } from '@/types/changes.js';
import { shouldPrefixAlias, withAliasPrefix } from './changePaths.js';
import { groupCheckpoints } from './checkpoints/checkpointGroups.js';
import { compareChoices, effectiveCompareBase, type CompareOption } from './compareChoices.js';
import { splitWorkspaceChanges } from './changeVisibility.js';
import { diffSourceId } from './useDiffSources.js';
import type { MountRevisions } from './useFileActions.js';

export type { CompareOption };

export interface UseChangesModelOptions {
  workspaceId: string | undefined;
  /** The base selector: `head`, `baseline`, `turn:<id>`, `checkpoint:<id>`, `stage:<id>`. */
  base: string;
  /** Names the session choice: "This chat" or "This run". */
  scope: 'chat' | 'run';
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function useChangesModel({ workspaceId, base: requestedBase, scope }: UseChangesModelOptions) {
  /**
   * The workspace's mounts — the authority for how many things this chat is
   * working on, what each is called, and what each branch was cut from.
   *
   * Two things hang off it: whether a displayed path carries its alias (only
   * worth it when there is more than one mount), and the "Branch base" entries
   * in the compare picker, which need each mount's `git.baseCommit`.
   */
  const workspaceInfo = useWorkspaceInfo(workspaceId);
  const mounts = useMemo(
    () => (workspaceInfo.data?.mounts ?? []).filter((m) => m.status !== 'removed'),
    [workspaceInfo.data],
  );
  const checkpoints = useWorkspaceCheckpoints(workspaceId);
  // Until the mounts load, assume git: the server answers `head` with the baseline for a mount without commits.
  const hasGit = mounts.length === 0 || mounts.some((m) => m.git?.isRepo);
  const base = effectiveCompareBase(requestedBase, hasGit);
  const summaryQuery = useWorkspaceChangeSummary(workspaceId, { base, head: 'working' });

  // Supporting files the agent scaffolds at the workspace root stay out of the
  // way while a real codebase is being reviewed — see changeVisibility.ts.
  const [showWorkspaceFiles, setShowWorkspaceFiles] = useState(false);
  const toggleWorkspaceFiles = useCallback(() => setShowWorkspaceFiles((v) => !v), []);
  const { visible: summary, hiddenWorkspaceFiles } = useMemo(
    () => splitWorkspaceChanges(summaryQuery.data, showWorkspaceFiles),
    [summaryQuery.data, showWorkspaceFiles],
  );

  /**
   * Whether a row's path is prefixed with its mount alias.
   *
   * Only when there is a choice to disambiguate. With one mount the alias is
   * the same word on every row, and worse, it makes the path wrong to copy
   * into a terminal. Falls back to the summary's repo count while the
   * workspace document is still loading, so the prefix never flickers on.
   */
  const mountCount = mounts.length || (summary?.repos.length ?? 0);
  const multiMount = shouldPrefixAlias(mountCount);
  const display = useCallback(
    (alias: string, path: string) => withAliasPrefix(alias, path, multiMount),
    [multiMount],
  );

  /** Per-mount roll-up for the group bar: what changed, and where. */
  const mountGroups = useMemo(() => {
    const byAlias = new Map(mounts.map((m) => [m.alias, m]));
    return (summary?.repos ?? []).map((repo) => ({
      alias: repo.alias,
      kind: repo.kind,
      stats: repo.stats,
      firstId: repo.files[0] ? diffSourceId(repo.alias, repo.files[0].path) : null,
      mount: byAlias.get(repo.alias),
    }));
  }, [summary, mounts]);

  const compareOptions = useMemo<CompareOption[]>(
    () =>
      compareChoices({
        base,
        hasGit,
        scope,
        groups: groupCheckpoints(checkpoints.data?.checkpoints ?? []),
        formatTime: timeOf,
      }),
    [base, hasGit, scope, checkpoints.data],
  );

  /**
   * Each mount's OWN base and head revision.
   *
   * The response-level `summary.base/head` is the FIRST mount's resolution.
   * Undo (does this mount have a base tree-ish?) and new review threads
   * (which checkpoint ids do they anchor to?) must read their own mount's —
   * the server resolves a checkpoint id only against the mount that wrote it
   * and silently falls back to that mount's baseline for any other. Falls
   * back to the response-level pair for a server that predates per-repo
   * revisions.
   */
  const revisionsByAlias = useMemo(() => {
    const map = new Map<string, MountRevisions>();
    const data = summaryQuery.data;
    for (const repo of data?.repos ?? []) {
      const baseRevision = repo.base ?? data?.base;
      const headRevision = repo.head ?? data?.head;
      map.set(repo.alias, {
        ...(baseRevision ? { base: baseRevision } : {}),
        ...(headRevision ? { head: headRevision } : {}),
      });
    }
    return map;
  }, [summaryQuery.data]);

  /**
   * Paths for the tree — the CHANGED files only.
   *
   * This surface answers "what changed?", so listing every file in the
   * workspace here would contradict the header count right above it ("8
   * changes" over a tree of hundreds) and duplicate the Files tab, which
   * exists precisely to browse everything. Deleted files are included even
   * though they are gone from disk: they are exactly what a reviewer wants
   * to click on.
   */
  const treePaths = useMemo(() => {
    const out = new Set<string>();
    for (const repo of summary?.repos ?? []) {
      for (const f of repo.files) out.add(display(repo.alias, f.path));
    }
    // No sort: the server already returns files in tree order, and the tree
    // component orders its own rows anyway.
    return [...out];
  }, [summary, display]);

  const treeStatuses = useMemo(() => {
    if (!summary) return [];
    const out: Array<{ path: string; status: ChangeStatus }> = [];
    for (const repo of summary.repos) {
      for (const f of repo.files) out.push({ path: display(repo.alias, f.path), status: f.status });
    }
    return out;
  }, [summary, display]);

  const stats = summary?.stats ?? { files: 0, additions: 0, deletions: 0 };

  return {
    /** The base the summary was asked for (`head` becomes `baseline` without git). */
    base,
    summary,
    stats,
    isLoading: summaryQuery.isLoading,
    isRefetching: summaryQuery.isRefetching,
    refetch: summaryQuery.refetch,
    mounts,
    multiMount,
    display,
    mountGroups,
    compareOptions,
    revisionsByAlias,
    treePaths,
    treeStatuses,
    showWorkspaceFiles,
    toggleWorkspaceFiles,
    hiddenWorkspaceFiles,
  };
}

export type ChangesModel = ReturnType<typeof useChangesModel>;

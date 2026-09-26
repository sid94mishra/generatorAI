// ────────────────────────────────────────────────────────────────
// useChangesModel — what the Changes panel is showing, derived from the
// summary-first API.
//
//   summary (GET /changes) → file list, per-mount revisions, mount groups,
//   tree paths/statuses, "Compare against" options.
//
// File bodies are fetched lazily per expanded row (useDiffSources); this
// hook never touches them.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from 'react';
import { useWorkspaceChangeSummary, useWorkspaceCheckpoints } from '@/hooks/queries.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import type { ChangeStatus } from '@/types/changes.js';
import { shouldPrefixAlias, withAliasPrefix } from './changePaths.js';
import { splitWorkspaceChanges } from './changeVisibility.js';
import { diffSourceId } from './useDiffSources.js';
import type { MountRevisions } from './useFileActions.js';

/** The at-most count of "Compare against" entries (see DISCREPANCY in the pins). */
const MAX_COMPARE_OPTIONS = 30;

export interface CompareOption {
  value: string;
  label: string;
}

export interface UseChangesModelOptions {
  workspaceId: string | undefined;
  /** The base selector: `baseline`, `ref:<sha>`, `turn:<id>`, `checkpoint:<id>`. */
  base: string;
}

export function useChangesModel({ workspaceId, base }: UseChangesModelOptions) {
  const summaryQuery = useWorkspaceChangeSummary(workspaceId, {
    base,
    head: 'working',
  });
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

  /**
   * What "compare against" offers.
   *
   * Turn checkpoints are grouped by `turnId`: one turn writes one checkpoint
   * PER MOUNT, so listing them raw produced the same prompt three times over.
   * `turn:<id>` is the selector the server resolves to that turn's snapshot.
   *
   * "Branch base" is the commit a mount's branch was cut from — the answer to
   * "what does this branch add?", which no checkpoint can express because
   * checkpoints only start at session start.
   */
  const compareOptions = useMemo<CompareOption[]>(() => {
    const options: CompareOption[] = [{ value: 'baseline', label: 'Since session start' }];

    for (const mount of mounts) {
      const sha = mount.git?.baseCommit;
      if (!sha) continue;
      options.push({
        value: `ref:${sha}`,
        label: `Branch base (${mount.git?.baseRef ?? mount.git?.branch ?? mount.alias})`,
      });
    }

    const seenTurns = new Set<string>();
    for (const c of checkpoints.data?.checkpoints ?? []) {
      if (c.kind === 'baseline' || c.kind === 'pre_restore') continue;
      if (c.turnId) {
        if (seenTurns.has(c.turnId)) continue;
        seenTurns.add(c.turnId);
      }
      options.push({
        value: c.turnId ? `turn:${c.turnId}` : `checkpoint:${c.id}`,
        label: `${c.label ?? c.kind} · ${new Date(c.createdAt).toLocaleTimeString()}`,
      });
      if (options.length > MAX_COMPARE_OPTIONS) break;
    }
    return options;
  }, [mounts, checkpoints.data]);

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

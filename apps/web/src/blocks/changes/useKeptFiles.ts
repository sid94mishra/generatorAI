// ────────────────────────────────────────────────────────────────
// useKeptFiles — Keep / Unkeep / Keep all and the "Kept (N)" group.
//
// Kept state is SERVER-side: the server stores the blob the user accepted,
// and a file drops back out of "Kept" by itself the moment the agent edits it
// again (its head blob moves). Nothing here tracks kept-ness locally.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from 'react';
import { useReviewWorkspaceChanges } from '@/hooks/queries.js';
import type { ChangeSummary } from '@/types/changes.js';
import type { FileActions } from './useFileActions.js';

/**
 * Split a summary into "still to review" and "kept".
 *
 * Kept files stay fully present — same ids, same diffs — they just move into
 * their own collapsed group so what is left in the main list is exactly the
 * work still needing a decision. Repos that end up empty on a side are
 * dropped from that side so neither list shows a heading with nothing in it.
 */
export function splitKeptFiles(summary: ChangeSummary | undefined): {
  pending: ChangeSummary | undefined;
  kept: ChangeSummary | undefined;
  keptCount: number;
} {
  if (!summary) return { pending: undefined, kept: undefined, keptCount: 0 };
  const keptRepos: ChangeSummary['repos'] = [];
  const pendingRepos: ChangeSummary['repos'] = [];
  let keptCount = 0;
  for (const repo of summary.repos) {
    const kept = repo.files.filter((f) => f.kept === true);
    const pending = repo.files.filter((f) => f.kept !== true);
    keptCount += kept.length;
    if (kept.length > 0) keptRepos.push({ ...repo, files: kept });
    if (pending.length > 0) pendingRepos.push({ ...repo, files: pending });
  }
  if (keptCount === 0) return { pending: summary, kept: undefined, keptCount: 0 };
  return {
    pending: { ...summary, repos: pendingRepos },
    kept: { ...summary, repos: keptRepos },
    keptCount,
  };
}

export interface UseKeptFilesOptions {
  workspaceId: string | undefined;
  /** The summary on screen (workspace files already split off). */
  summary: ChangeSummary | undefined;
  actions: Pick<FileActions, 'runRowAction' | 'runBulkAction'>;
}

export function useKeptFiles({ workspaceId, summary, actions }: UseKeptFilesOptions) {
  const reviewChanges = useReviewWorkspaceChanges(workspaceId);
  const { runRowAction, runBulkAction } = actions;

  const { pending, kept, keptCount } = useMemo(() => splitKeptFiles(summary), [summary]);

  /** Whether the "Kept (N)" group at the bottom is open. */
  const [showKept, setShowKept] = useState(false);
  const openKept = useCallback(() => setShowKept(true), []);
  const toggleKept = useCallback(() => setShowKept((v) => !v), []);

  /**
   * Mark one file reviewed, at exactly the content on screen. `path` is the
   * summary's repo-relative path, sent as-is (see `revertFile`).
   */
  const keepFile = useCallback(
    (id: string, alias: string, path: string, blob: string | undefined) =>
      runRowAction(id, () =>
        // A deleted file has no head blob; `''` is the sentinel for it.
        reviewChanges.mutateAsync({ keep: [{ alias, path, blob: blob ?? '' }] }),
      ),
    [reviewChanges, runRowAction],
  );

  const unkeepFile = useCallback(
    (id: string, alias: string, path: string) =>
      runRowAction(id, () => reviewChanges.mutateAsync({ unkeep: [{ alias, path }] })),
    [reviewChanges, runRowAction],
  );

  /** Accept everything currently changed. Resolved server-side, on live blobs. */
  const keepAll = useCallback(
    () => runBulkAction('keep', () => reviewChanges.mutateAsync({ keepAll: true })),
    [reviewChanges, runBulkAction],
  );

  return {
    pending,
    kept,
    keptCount,
    showKept,
    openKept,
    toggleKept,
    keepFile,
    unkeepFile,
    keepAll,
  };
}

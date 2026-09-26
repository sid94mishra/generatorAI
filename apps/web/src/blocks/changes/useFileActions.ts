// ────────────────────────────────────────────────────────────────
// useFileActions — Undo one file / Undo all, and the busy + error state every
// per-file and bulk action on the Changes panel shares.
//
// Keep / Unkeep / Keep all (useKeptFiles) run through `runRowAction` /
// `runBulkAction` here so a row shows ONE spinner whichever action it is
// running, and one dismissible banner reports whichever action failed.
// ────────────────────────────────────────────────────────────────

import { useCallback, useState } from 'react';
import { useDiscardWorkspaceChanges } from '@/hooks/queries.js';
import type { ChangeRevision, DiscardChangesResult } from '@/types/changes.js';

/** THIS mount's resolved base / head (see `useChangesModel`). */
export interface MountRevisions {
  base?: ChangeRevision;
  head?: ChangeRevision;
}

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'default' | 'destructive';
}

export interface ChangesNotice {
  title: string;
  description: string;
}

export interface UseFileActionsOptions {
  workspaceId: string | undefined;
  revisionsByAlias: ReadonlyMap<string, MountRevisions>;
  /** How a file is named on screen (alias-prefixed only with several mounts). */
  display: (alias: string, path: string) => string;
  /** Asks the user; resolves true to go ahead. The host owns the dialog. */
  requestConfirmation: (request: ConfirmRequest) => Promise<boolean>;
  /** Shows a warning. The host owns the toast surface. */
  warn: (notice: ChangesNotice) => void;
}

export type BulkAction = 'keep' | 'undo';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useFileActions({
  workspaceId,
  revisionsByAlias,
  display,
  requestConfirmation,
  warn,
}: UseFileActionsOptions) {
  const discardChanges = useDiscardWorkspaceChanges(workspaceId);

  /** File id awaiting discard confirmation, and the last action failure. */
  const [confirmRevert, setConfirmRevert] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which row is mid-flight, by diff source id.
   *
   * Per row, not per mutation: react-query's `isPending` is one flag shared
   * by every call the hook makes, so undoing one file greyed out — and
   * showed "Discarding…" on — the discard button of every other file at once.
   */
  const [busyRow, setBusyRow] = useState<string | null>(null);
  /** True while a bulk Keep all / Undo all is running. */
  const [bulkBusy, setBulkBusy] = useState<null | BulkAction>(null);

  const dismissError = useCallback(() => setError(null), []);
  const requestRevert = useCallback((id: string) => setConfirmRevert(id), []);
  const cancelRevert = useCallback(() => setConfirmRevert(null), []);

  /**
   * A mount can be undone as soon as it resolved a base tree-ish at all; the
   * server restores from a commit just as happily as from a checkpoint row.
   * Per mount: the response-level base is the FIRST mount's, and hiding Undo
   * whenever that one had no checkpoint id hid it on every other mount too.
   */
  const canRevertFile = useCallback(
    (alias: string) => !!workspaceId && !!revisionsByAlias.get(alias)?.base?.treeish,
    [workspaceId, revisionsByAlias],
  );

  /** Report paths the server refused rather than dropping them silently. */
  const reportSkipped = useCallback(
    (skipped: DiscardChangesResult['skipped']) => {
      if (skipped.length === 0) return;
      const reasons = [...new Set(skipped.map((s) => s.reason))].join(', ');
      warn({
        title: `${skipped.length} ${skipped.length === 1 ? 'file was' : 'files were'} skipped`,
        description: `${reasons}. ${skipped
          .slice(0, 4)
          .map((s) => display(s.alias, s.path))
          .join(', ')}${skipped.length > 4 ? '…' : ''}`,
      });
    },
    [display, warn],
  );

  const reportDiscard = useCallback(
    (result: DiscardChangesResult) => {
      reportSkipped(result.skipped);
      const failed = result.mounts.find((m) => !m.ok);
      if (failed?.error) setError(failed.error);
    },
    [reportSkipped],
  );

  /** Run one row's action with that row's spinner and the shared error banner. */
  const runRowAction = useCallback(async (id: string, action: () => Promise<unknown>) => {
    setError(null);
    setBusyRow(id);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyRow(null);
    }
  }, []);

  /** Run a bulk action; every bulk control is disabled while one runs. */
  const runBulkAction = useCallback(async (kind: BulkAction, action: () => Promise<unknown>) => {
    setError(null);
    setBulkBusy(kind);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBulkBusy(null);
    }
  }, []);

  /**
   * Undo one file's changes, returning it to its mount's base revision.
   *
   * Deliberately a server-side restore rather than a reverse-applied patch:
   * restoring is tree-to-tree (adds, deletes and renames all behave), it
   * writes a `pre_restore` checkpoint so the undo is itself undoable, and it
   * refuses to write through symlinks.
   *
   * `path` is the summary's REPO-RELATIVE path and is sent as-is. A mount's
   * base tree is that mount's tree, so an alias prefix names a file that is
   * not in it — and stripping a "prefix" from a path that is already
   * repo-relative aimed the restore at a different file whenever the path
   * happened to start with the mount's own name (`api/handler.ts` in `api`).
   */
  const revertFile = useCallback(
    async (id: string, alias: string, path: string) => {
      setError(null);
      setBusyRow(id);
      try {
        reportDiscard(await discardChanges.mutateAsync({ files: [{ alias, path }] }));
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusyRow(null);
        setConfirmRevert(null);
      }
    },
    [discardChanges, reportDiscard],
  );

  /**
   * Throw away every change in the workspace. Confirmed first: this is the
   * one action on the panel that can lose a whole turn's work — though the
   * per-mount `pre_restore` checkpoints still make it recoverable from the
   * rewind timeline.
   */
  const undoAll = useCallback(async () => {
    const ok = await requestConfirmation({
      title: 'Undo all changes?',
      description:
        `This restores every changed file in this workspace to its base revision. ` +
        `A checkpoint is written first, so it can still be rewound.`,
      confirmLabel: 'Undo all',
      variant: 'destructive',
    });
    if (!ok) return;
    await runBulkAction('undo', async () => {
      reportDiscard(await discardChanges.mutateAsync({ all: true }));
    });
  }, [requestConfirmation, discardChanges, reportDiscard, runBulkAction]);

  return {
    busyRow,
    bulkBusy,
    error,
    dismissError,
    confirmRevert,
    requestRevert,
    cancelRevert,
    canRevertFile,
    revertFile,
    undoAll,
    runRowAction,
    runBulkAction,
  };
}

export type FileActions = ReturnType<typeof useFileActions>;

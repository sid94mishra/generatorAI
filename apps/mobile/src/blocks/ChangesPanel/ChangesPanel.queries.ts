// MB-22 data: the workspace's mounts (branch bases for the compare bar), checkpoints, source-control readiness (the
// branch chip, the commit footer, a merge left in progress) and the review actions — Keep / Unkeep / Keep all
// (MD-07, the kept-files semantics of web `useKeptFiles`), Discard one file and Undo all (each mount from its OWN
// base; `changes/discard` snapshots first, so both are undoable from a checkpoint). Every success refreshes the
// workspace's queries and the readiness (its file count moves with them).
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, scmKeys, type ChangeFileRef } from '@generatorai/client-core';

import { useApi } from '../../services/api/useApi';
import { useCapability } from '../../services/auth/useCapability';
import { haptic } from '../../ui/platform/haptics';
import { toast } from '../../ui/primitives/Toast';
import type { MountInfo } from './model/compareModel';
import { keepRef, type KeepableFile } from './model/keptModel';

export function useWorkspaceMounts(workspaceId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['workspaces', workspaceId ?? '', 'info'] as const,
    queryFn: async () => {
      const info = (await api.workspaces.get(workspaceId!)) as { mounts?: Array<MountInfo & { kind?: string; mode?: string; path?: string; hasUncommittedChanges?: boolean }> };
      return (info.mounts ?? []).filter((m) => m.status !== 'removed');
    },
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
}

export function useCheckpoints(workspaceId: string | null, active = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.checkpoints(workspaceId ?? ''),
    queryFn: () => api.workspaces.checkpoints(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    subscribed: active,
  });
}

/** Source-control state per mount (`GET …/scm/readiness`); a device without the scope gets nothing, not retries. */
export function useScmReadiness(workspaceId: string | null, active = true) {
  const api = useApi();
  const commit = useCapability('commit');
  return useQuery({
    queryKey: scmKeys.readiness(workspaceId ?? ''),
    queryFn: () => api.scm.readiness(workspaceId!),
    enabled: Boolean(workspaceId) && commit.available,
    staleTime: 15_000,
    subscribed: active,
    retry: false,
  });
}

export interface ChangeActions {
  keep: (file: KeepableFile & { id: string }) => void;
  unkeep: (file: KeepableFile & { id: string }) => void;
  keepAll: () => void;
  discard: (file: ChangeFileRef & { id: string }) => void;
  undoAll: () => void;
  /** Files with a request in flight (their row shows it). */
  busy: ReadonlySet<string>;
  bulkBusy: boolean;
  canReview: boolean;
  canRestore: boolean;
  restoreReason: string | null;
}

export function useChangeActions(workspaceId: string | null): ChangeActions {
  const api = useApi();
  const client = useQueryClient();
  const review = useCapability('writeReviews');
  const restoreCap = useCapability('restoreCheckpoints');
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const mark = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const refresh = useCallback(() => {
    if (!workspaceId) return;
    void client.invalidateQueries({ queryKey: ['workspaces', workspaceId] });
    void client.invalidateQueries({ queryKey: scmKeys.readiness(workspaceId) });
  }, [client, workspaceId]);
  const fail = (fallback: string) => (err: unknown) => {
    haptic('error');
    toast({ kind: 'error', message: err instanceof Error && err.message ? err.message : fallback });
  };

  const reviewFiles = useMutation({
    mutationFn: (body: Parameters<typeof api.workspaces.reviewChanges>[1]) => api.workspaces.reviewChanges(workspaceId!, body),
    onSuccess: refresh,
    onError: fail("Couldn't update the review."),
  });
  const restore = useMutation({
    mutationFn: (body: Parameters<typeof api.workspaces.discardChanges>[1]) => api.workspaces.discardChanges(workspaceId!, body),
    onSuccess: (result) => {
      refresh();
      const failed = result.mounts.find((m) => !m.ok);
      if (failed?.error) toast({ kind: 'error', message: failed.error });
      else haptic('success');
    },
    onError: fail("Couldn't discard those changes."),
  });

  return {
    keep: (file) => {
      haptic('selection');
      mark(file.id, true);
      reviewFiles.mutate({ keep: [keepRef(file)] }, { onSettled: () => mark(file.id, false) });
    },
    unkeep: (file) => {
      haptic('selection');
      mark(file.id, true);
      reviewFiles.mutate({ unkeep: [{ alias: file.alias, path: file.path }] }, { onSettled: () => mark(file.id, false) });
    },
    keepAll: () => {
      haptic('selection');
      reviewFiles.mutate({ keepAll: true });
    },
    discard: (file) => {
      mark(file.id, true);
      restore.mutate({ files: [{ alias: file.alias, path: file.path }] }, { onSettled: () => mark(file.id, false) });
    },
    undoAll: () => restore.mutate({ all: true }),
    busy,
    bulkBusy: reviewFiles.isPending || restore.isPending,
    canReview: review.available,
    canRestore: restoreCap.available,
    restoreReason: restoreCap.reason,
  };
}

/** A merge left in progress (MB-22 banner, `scm-merge-in-progress`): ask the chat's agent, continue, or abort. */
export function useConflictActions(workspaceId: string | null, chatId: string | null) {
  const api = useApi();
  const client = useQueryClient();
  const refresh = (): void => {
    if (!workspaceId) return;
    void client.invalidateQueries({ queryKey: scmKeys.readiness(workspaceId) });
    void client.invalidateQueries({ queryKey: ['workspaces', workspaceId] });
  };
  const fail = (fallback: string) => (err: unknown) => {
    haptic('error');
    toast({ kind: 'error', message: err instanceof Error && err.message ? err.message : fallback });
  };
  const askAgent = useMutation({
    mutationFn: (alias: string) => {
      if (!chatId) throw new Error('Open this workspace from its chat to ask the agent.');
      return api.scm.resolveConflictsWithAgent(workspaceId!, { alias, chatId });
    },
    onSuccess: refresh,
    onError: fail("Couldn't reach the agent."),
  });
  const continueMerge = useMutation({
    mutationFn: (alias: string) => api.scm.continueConflicts(workspaceId!, { alias }),
    onSuccess: refresh,
    onError: fail("Couldn't finish the merge."),
  });
  const abortMerge = useMutation({
    mutationFn: (alias: string) => api.scm.abortConflicts(workspaceId!, { alias }),
    onSuccess: refresh,
    onError: fail("Couldn't abort the merge."),
  });
  return { askAgent, continueMerge, abortMerge, busy: askAgent.isPending || continueMerge.isPending || abortMerge.isPending };
}

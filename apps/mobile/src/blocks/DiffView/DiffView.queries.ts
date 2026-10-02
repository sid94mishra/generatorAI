// MB-24 data: one file's patch (keyed by its blob pair: a path-only key leaves an edited file's old diff on screen),
// and the review threads of a workspace + scope with their mutations — one query shared by the Changes list
// (comment counts, the pending bar) and the diff (inline threads), so a reply updates both. Scope-gated: without
// `read:reviews` the query never fires and the reason says why (MD-61).
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ReviewThread } from '@generatorai/client-core';
import type { ReviewIntent } from '@generatorai/shared';

import { useApi } from '../../services/api/useApi';
import { useCapability } from '../../services/auth/useCapability';
import { haptic } from '../../ui/platform/haptics';
import { toast } from '../../ui/primitives/Toast';
import type { DiffSide } from './model/diffModel';
import { buildReviewBatch, groupThreadsByFile, type ReviewSubmitTarget } from './model/reviewBatch';

export function useFilePatch(workspaceId: string, file: { path: string; alias?: string; oldBlob?: string; newBlob?: string }, base: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.changeFile(workspaceId, file.path, file.oldBlob, file.newBlob), base, file.alias ?? '.'],
    queryFn: () =>
      api.workspaces.filePatch(workspaceId, {
        path: file.path,
        base,
        head: 'working',
        ...(file.alias ? { alias: file.alias } : {}),
        ...(file.oldBlob ? { oldBlob: file.oldBlob } : {}),
        ...(file.newBlob ? { newBlob: file.newBlob } : {}),
      }),
    enabled: Boolean(workspaceId && file.path),
    // A diff for a specific blob pair is immutable; only the working side moves.
    staleTime: file.newBlob ? Infinity : 10_000,
  });
}

export interface ReviewScope {
  scope: 'chat' | 'run' | 'automation';
  scopeId: string;
}

export interface NewThreadInput {
  path: string;
  alias: string;
  side: DiffSide;
  startLine: number;
  endLine: number;
  anchorText: string;
  body: string;
  intent: ReviewIntent;
  baseCheckpointId: string;
  headCheckpointId: string;
}

export function useReviewThreads(workspaceId: string | null, scope: ReviewScope | null, options: { active?: boolean; target?: ReviewSubmitTarget | null } = {}) {
  const api = useApi();
  const client = useQueryClient();
  const read = useCapability('readReviews');
  const write = useCapability('writeReviews');
  const active = options.active ?? true;
  const target = options.target ?? null;
  const key = useMemo(() => [...queryKeys.reviewThreads(workspaceId ?? ''), scope?.scope ?? '-', scope?.scopeId ?? '-'] as const, [workspaceId, scope?.scope, scope?.scopeId]);

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.review.threadsForScope(workspaceId!, { ...(scope ? { scope: scope.scope, scopeId: scope.scopeId } : {}), all: true }),
    enabled: Boolean(workspaceId) && read.available,
    staleTime: 10_000,
    subscribed: active,
  });
  const invalidate = useCallback(() => void client.invalidateQueries({ queryKey: queryKeys.reviewThreads(workspaceId ?? '') }), [client, workspaceId]);
  const fail = (fallback: string) => (err: unknown) => {
    haptic('error');
    toast({ kind: 'error', message: err instanceof Error && err.message ? err.message : fallback });
  };
  const threads = useMemo<ReviewThread[]>(() => query.data?.threads ?? [], [query.data]);
  const byFile = useMemo(() => groupThreadsByFile(threads), [threads]);

  const create = useMutation({
    mutationFn: (input: NewThreadInput) =>
      api.review.createThread(workspaceId!, {
        scope: scope!.scope,
        scopeId: scope!.scopeId,
        alias: input.alias,
        path: input.path,
        side: input.side,
        startLine: input.startLine,
        endLine: input.endLine,
        anchorText: input.anchorText,
        body: input.body,
        intent: input.intent,
        baseCheckpointId: input.baseCheckpointId,
        headCheckpointId: input.headCheckpointId,
      }),
    onSuccess: invalidate,
    onError: fail("Couldn't add the comment."),
  });
  const setStatus = useMutation({
    mutationFn: (vars: { threadId: string; status: 'resolved' | 'pending' }) => api.review.setThreadStatus(workspaceId!, vars.threadId, vars.status),
    onSuccess: invalidate,
    onError: fail("Couldn't update the comment."),
  });
  const remove = useMutation({
    mutationFn: (threadId: string) => api.review.deleteThread(workspaceId!, threadId),
    onSuccess: invalidate,
    onError: fail("Couldn't delete the comment."),
  });
  const submit = useMutation({
    mutationFn: (vars: { note?: string; onlyIds?: string[] }) => {
      const body = buildReviewBatch(threads, target ?? { kind: 'clipboard' }, vars);
      if (!body) return Promise.reject(new Error('Nothing pending to send'));
      return api.review.submit(workspaceId!, body);
    },
    onSuccess: () => {
      invalidate();
      haptic('success');
    },
    onError: fail("Couldn't send the review."),
  });

  return {
    threads,
    byFile,
    isLoading: query.isLoading,
    canRead: read.available,
    canWrite: write.available && scope !== null,
    writeReason: write.available ? (scope === null ? 'Open this workspace from its chat to leave review comments.' : null) : write.reason,
    /** Somewhere to send: a chat (a finished run or no target cannot take a review). */
    canSend: write.available && scope !== null && target !== null && target.kind !== 'clipboard',
    create,
    setStatus,
    remove,
    submit,
  };
}

export type ReviewThreadsApi = ReturnType<typeof useReviewThreads>;

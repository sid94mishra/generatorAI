// ────────────────────────────────────────────────────────────────
// Review threads for a workspace + scope, and the mutations on them.
//
// One query, shared between the Changes pane (gutter markers, file badges)
// and the comments sheet, so a reply in the sheet updates the marker in the
// diff without a second fetch. Scope-gated: without `read:reviews` the
// query never fires and `reason` explains the empty state.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ReviewThread } from '@generatorai/client-core';

import { useApi } from '../../api/useApi';
import { useToast } from '../ui/Toast';
import { useReviewExtras } from './api';
import { buildReviewBatch, groupThreadsByFile, type ReviewIntent, type ReviewSubmitTarget } from './reviewBatch';
import { useCapability } from './useScopes';
import type { DiffSide } from '../changes/diffModel';

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

export function useReviewThreads(
  workspaceId: string | null | undefined,
  scope: ReviewScope | null,
  options: { active?: boolean; target?: ReviewSubmitTarget | null } = {},
) {
  const api = useApi();
  const extras = useReviewExtras();
  const queryClient = useQueryClient();
  const toast = useToast();
  const read = useCapability('readReviews');
  const write = useCapability('writeReviews');
  const active = options.active ?? true;
  const target = options.target ?? null;

  const key = useMemo(
    () => [...queryKeys.reviewThreads(workspaceId ?? ''), scope?.scope ?? '-', scope?.scopeId ?? '-'] as const,
    [workspaceId, scope?.scope, scope?.scopeId],
  );

  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      extras.threads(workspaceId!, {
        ...(scope ? { scope: scope.scope, scopeId: scope.scopeId } : {}),
        all: true,
      }),
    enabled: Boolean(workspaceId) && read.available,
    staleTime: 10_000,
    subscribed: active,
  });

  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.reviewThreads(workspaceId ?? '') }),
    [queryClient, workspaceId],
  );
  const fail = useCallback(
    (fallback: string) => (err: unknown) =>
      toast({ message: err instanceof Error ? err.message : fallback, tone: 'error' }),
    [toast],
  );

  const threads = useMemo(() => query.data?.threads ?? [], [query.data]);
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
    onError: fail('Could not add the comment'),
  });

  const reply = useMutation({
    mutationFn: (vars: { threadId: string; body: string; intent?: ReviewIntent }) =>
      api.review.addComment(workspaceId!, vars.threadId, {
        body: vars.body,
        ...(vars.intent ? { intent: vars.intent } : {}),
      }),
    onSuccess: invalidate,
    onError: fail('Could not add the reply'),
  });

  const edit = useMutation({
    mutationFn: (vars: { threadId: string; commentId: string; body: string }) =>
      extras.updateComment(workspaceId!, vars.threadId, vars.commentId, vars.body),
    onSuccess: invalidate,
    onError: fail('Could not edit the comment'),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { threadId: string; status: 'resolved' | 'pending' }) =>
      api.review.setThreadStatus(workspaceId!, vars.threadId, vars.status),
    onSuccess: invalidate,
    onError: fail('Could not update the thread'),
  });

  const remove = useMutation({
    mutationFn: (threadId: string) => extras.deleteThread(workspaceId!, threadId),
    onSuccess: invalidate,
    onError: fail('Could not delete the thread'),
  });

  const submit = useMutation({
    mutationFn: (vars: { note?: string; preview?: boolean; onlyIds?: string[] }) => {
      const body = buildReviewBatch(threads, target ?? { kind: 'clipboard' }, vars);
      if (!body) return Promise.reject(new Error('Nothing pending to send'));
      return extras.submit(workspaceId!, body);
    },
    onSuccess: (result, vars) => {
      invalidate();
      if (!vars.preview) {
        toast({
          message: result.delivered
            ? `Sent ${result.threadIds.length} ${result.threadIds.length === 1 ? 'comment' : 'comments'} to the agent`
            : 'Review prompt built but not delivered',
          tone: result.delivered ? 'success' : 'info',
        });
      }
    },
    onError: fail('Could not send the review'),
  });

  return {
    threads,
    byFile,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    canRead: read.available,
    readReason: read.reason,
    canWrite: write.available && scope !== null,
    writeReason: write.available
      ? scope === null
        ? 'Open this workspace from its chat to leave review comments.'
        : null
      : write.reason,
    /** Nowhere to send — a finished run, or no chat target. */
    canSend: write.available && scope !== null && target !== null && target.kind !== 'clipboard',
    create,
    reply,
    edit,
    setStatus,
    remove,
    submit,
  };
}

export type ReviewThreadsApi = ReturnType<typeof useReviewThreads>;
export type { ReviewThread };

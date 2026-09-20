// ────────────────────────────────────────────────────────────────
// Review query hooks
// ────────────────────────────────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '@/providers/PlatformProvider.js';
import type { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';
import type {
  CreateReviewThreadInput,
  ReviewIntent,
  ReviewSubmitTarget,
  ReviewThreadStatus,
} from '@/types/review.js';

export function reviewThreadsKey(workspaceId: string | undefined, scopeId?: string) {
  return ['review-threads', workspaceId ?? '', scopeId ?? ''] as const;
}

/** Open threads for a workspace (optionally narrowed to one chat/run). */
export function useReviewThreads(
  workspaceId: string | undefined,
  options: { scope?: string; scopeId?: string; all?: boolean } = {},
  enabled = true,
) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: reviewThreadsKey(workspaceId, options.scopeId),
    queryFn: () => platform.listReviewThreads(workspaceId!, options),
    enabled: !!workspaceId && enabled,
    staleTime: 5_000,
    // Re-anchoring happens asynchronously after the workspace event. Its
    // first invalidation can race that work; poll only submitted feedback
    // until the server reports its updated state.
    refetchInterval: (query) =>
      query.state.data?.threads.some((thread) => thread.status === 'submitted') ? 3_000 : false,
  });
}

export function useCreateReviewThread(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReviewThreadInput) =>
      platform.createReviewThread(workspaceId!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-threads', workspaceId] });
    },
  });
}

export function useAddReviewComment(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { threadId: string; body: string; intent?: ReviewIntent }) =>
      platform.addReviewComment(
        workspaceId!,
        params.threadId,
        params.body,
        params.intent,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-threads', workspaceId] });
    },
  });
}

export function useUpdateReviewComment(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { threadId: string; commentId: string; body: string }) =>
      platform.updateReviewComment(
        workspaceId!,
        params.threadId,
        params.commentId,
        params.body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-threads', workspaceId] });
    },
  });
}

export function useUpdateReviewThreadStatus(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { threadId: string; status: ReviewThreadStatus }) =>
      platform.updateReviewThreadStatus(workspaceId!, params.threadId, params.status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-threads', workspaceId] });
    },
  });
}

export function useDeleteReviewThread(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => platform.deleteReviewThread(workspaceId!, threadId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-threads', workspaceId] });
    },
  });
}

/**
 * Submit a batch of review threads to the agent.
 *
 * Invalidates chat history too, because a successful submission posts a new
 * user message into the conversation.
 */
export function useSubmitReview(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      threadIds: string[];
      target: ReviewSubmitTarget;
      note?: string;
      preview?: boolean;
    }) => platform.submitReview(workspaceId!, input),
    onSuccess: (result) => {
      if (!result.delivered) return;
      void queryClient.invalidateQueries({ queryKey: ['review-threads', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
    },
  });
}

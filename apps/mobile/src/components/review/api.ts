import { useMemo } from 'react';
import { useApi } from '../../services/api/useApi';
export type { PlanDocumentInfo, PlanRevisionInfo, PlanCommentInfo, TaskDigest } from '@generatorai/client-core';

export function useReviewExtras() {
  const { review } = useApi();
  return useMemo(() => ({ ...review, threads: review.threadsForScope }), [review]);
}

export function usePlanExtras() {
  return useApi().plans;
}

export function useTaskExtras() {
  const { chats } = useApi();
  return useMemo(() => ({ digest: chats.backgroundTaskDigest, cancel: chats.cancelBackgroundTask }), [chats]);
}

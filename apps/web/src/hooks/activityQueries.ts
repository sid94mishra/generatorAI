// ────────────────────────────────────────────────────────────────
// Recently finished activity hook (G-11) — Home "Recently finished".
//
// Merges chats' finished turns, terminal workflow runs and terminal
// automation executions into one feed, newest first. Pull-request- and
// commit-derived items are not built in this pass (see
// `packages/shared/src/types/RecentActivity.ts`). No SSE: Home refetches it
// when the attention feed (G-01) loses an item (something just finished).
// ────────────────────────────────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecentActivityItem } from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';

export interface RecentActivityQuery {
  since?: string;
  limit?: number;
  projectId?: string;
}

export const activityKeys = {
  all: ['activity-recent'] as const,
  recent: (query?: RecentActivityQuery) => ['activity-recent', query ?? {}] as const,
};

export function useRecentActivity(query?: RecentActivityQuery) {
  const platform = usePlatform();
  return useQuery({
    queryKey: activityKeys.recent(query),
    queryFn: () => platform.getRecentActivity(query),
    staleTime: 30_000,
  });
}

/** How many of the chat's latest messages are searched for the prompt to resend. */
const RETRY_HISTORY = 50;

/**
 * Retry a failed item with the existing endpoints (05 §G-11): a failed chat
 * resends its last prompt (`POST /chats/:id/prompt`), a failed run is forked
 * (engine v2: a terminal run is never mutated — "Retry failed" is a fork
 * invocation on the pinned definition with a fresh workspace, like the run
 * page's). Resolves to the new run's id for a run.
 */
export function useRetryActivity() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: Pick<RecentActivityItem, 'entityId' | 'retry'>): Promise<{ runId?: string }> => {
      if (item.retry === 'run_retry') {
        const fork = await platform.invokeWorkflow({
          target: { kind: 'fork', sourceRunId: item.entityId, definition: 'pinned', workspace: 'fresh' },
          variables: {},
          client: 'web',
        });
        return { runId: fork.runId };
      }
      if (item.retry === 'chat_prompt') {
        const messages = await platform.getChatMessages(item.entityId, RETRY_HISTORY);
        const last = [...messages].reverse().find((m) => m.role === 'user' && m.content.trim());
        if (!last) throw new Error('This chat has no prompt to send again.');
        await platform.sendChatPrompt(item.entityId, last.content);
        return {};
      }
      throw new Error('This item cannot be retried.');
    },
    meta: { errorTitle: 'Retry failed' },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}

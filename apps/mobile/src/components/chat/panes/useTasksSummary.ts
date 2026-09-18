// ────────────────────────────────────────────────────────────────
// useTasksSummary — how many background workers a chat has, and how many
// are still running. Drives the Tasks segment's count and the menu's.
//
// Same query key as `TasksSection`, so the pane and this summary share one
// cache entry. The chat stream invalidates it on task events; the slow poll
// is only a fallback while a worker is in flight and the Tasks pane (which
// polls faster itself) is not on screen.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys, type BackgroundTaskSummary } from '@generatorai/client-core';

import { useApi } from '../../../api/useApi';

/** Worker statuses that count as "running". Mirrors `TasksSection`'s ACTIVE set. */
export const ACTIVE_TASK_STATUSES: ReadonlySet<string> = new Set(['spawned', 'running', 'reviewing', 'queued', 'needs_review']);

export interface TasksSummary {
  total: number;
  running: number;
}

export function useTasksSummary(chatId: string, options: { pollPaused?: boolean } = {}): TasksSummary {
  const api = useApi();
  const pollPaused = options.pollPaused ?? false;
  const tasks = useQuery({
    queryKey: queryKeys.chatTasks(chatId),
    queryFn: () => api.chats.backgroundTasks(chatId),
    staleTime: 15_000,
    retry: false,
    refetchInterval: (query) => {
      if (pollPaused) return false;
      const list = query.state.data?.tasks ?? [];
      return list.some((t: BackgroundTaskSummary) => ACTIVE_TASK_STATUSES.has(t.status)) ? 10_000 : false;
    },
  });
  const list = tasks.data?.tasks;
  return useMemo(
    () => ({
      total: list?.length ?? 0,
      running: (list ?? []).filter((t: BackgroundTaskSummary) => ACTIVE_TASK_STATUSES.has(t.status)).length,
    }),
    [list],
  );
}

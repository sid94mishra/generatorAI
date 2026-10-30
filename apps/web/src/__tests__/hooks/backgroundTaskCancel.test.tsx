// ────────────────────────────────────────────────────────────────
// useCancelBackgroundTask — the G-20 web hook.
//
// Pinned: it calls the platform's cancel for the chat's task and writes the
// server's attribution (who / when) into the cached task list at once, so a
// row can read "Cancelled · by you at …" before the next poll.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { BackgroundTaskListItem, IPlatformClient } from '@generatorai/shared';

import { PlatformContext } from '@/providers/PlatformProvider.js';
import { backgroundTasksKeys, useCancelBackgroundTask } from '@/hooks/queries.js';

describe('useCancelBackgroundTask', () => {
  it('cancels through the platform and stores the attribution in the list cache', async () => {
    const platform = {
      cancelBackgroundTask: vi.fn(async (_chatId: string, taskId: string) => ({
        ok: true as const,
        taskId,
        cancelledBy: 'user' as const,
        cancelledAt: 1_700,
      })),
      getBackgroundTasks: vi.fn(async () => ({ tasks: [] })),
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tasks: BackgroundTaskListItem[] = [
      { taskId: 't1', taskName: 'audit', status: 'running', reviewRounds: 0 },
      { taskId: 't2', taskName: 'docs', status: 'running', reviewRounds: 0 },
    ];
    queryClient.setQueryData(backgroundTasksKeys.list('orch'), { tasks });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <PlatformContext.Provider value={platform as unknown as IPlatformClient}>{children}</PlatformContext.Provider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useCancelBackgroundTask('orch'), { wrapper });
    await act(() => result.current.mutateAsync('t1'));

    expect(platform.cancelBackgroundTask).toHaveBeenCalledWith('orch', 't1');
    const cached = queryClient.getQueryData<{ tasks: BackgroundTaskListItem[] }>(backgroundTasksKeys.list('orch'));
    expect(cached?.tasks).toEqual([
      { taskId: 't1', taskName: 'audit', status: 'cancelled', reviewRounds: 0, cancelledBy: 'user', cancelledAt: 1_700 },
      tasks[1],
    ]);
  });
});

// ────────────────────────────────────────────────────────────────
// Recently finished activity hook (G-11) — wraps `platform.getRecentActivity`.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { IPlatformClient, RecentActivityPage } from '@generatorai/shared';

import { PlatformContext } from '@/providers/PlatformProvider.js';
import { useRecentActivity } from '@/hooks/activityQueries.js';

const PAGE: RecentActivityPage = {
  items: [
    {
      key: 'chat:c1',
      entity: 'chat',
      entityId: 'c1',
      title: 'Fix the flaky test',
      href: '/chats/c1',
      endedAt: '2026-01-05T00:00:00.000Z',
      outcome: 'succeeded',
      summary: 'Turn completed',
    },
  ],
};

function setup() {
  const platform = { getRecentActivity: vi.fn().mockResolvedValue(PAGE) };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>{children}</PlatformContext.Provider>
    </QueryClientProvider>
  );
  return { platform, wrapper };
}

describe('useRecentActivity', () => {
  it('fetches the feed with no query by default', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useRecentActivity(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.getRecentActivity).toHaveBeenCalledWith(undefined);
    expect(result.current.data).toEqual(PAGE);
  });

  it('forwards the query (since/limit/projectId)', async () => {
    const { platform, wrapper } = setup();
    const query = { since: '2026-01-01T00:00:00Z', limit: 10, projectId: 'proj-1' };
    const { result } = renderHook(() => useRecentActivity(query), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.getRecentActivity).toHaveBeenCalledWith(query);
  });
});

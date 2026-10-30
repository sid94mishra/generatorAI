// ────────────────────────────────────────────────────────────────
// Stats summary hook (G-10) — the caller supplies `from`/`to` in its own
// local time zone; the hook is disabled until a range is given, never
// guessing a default.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { IPlatformClient, StatsSummary } from '@generatorai/shared';

import { PlatformContext } from '@/providers/PlatformProvider.js';
import { useStatsSummary } from '@/hooks/statsQueries.js';

const SUMMARY: StatsSummary = {
  range: { from: '2026-01-01T00:00:00Z', to: '2026-01-07T23:59:59Z' },
  chats: { created: 4 },
  runs: { total: 2, succeeded: 1, failed: 1, cancelled: 0 },
};

function setup() {
  const platform = { getStatsSummary: vi.fn().mockResolvedValue(SUMMARY) };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>{children}</PlatformContext.Provider>
    </QueryClientProvider>
  );
  return { platform, wrapper };
}

describe('useStatsSummary', () => {
  it('does not call the platform until a range is supplied', () => {
    const { platform, wrapper } = setup();
    renderHook(() => useStatsSummary(undefined), { wrapper });
    expect(platform.getStatsSummary).not.toHaveBeenCalled();
  });

  it('fetches the summary for the given range', async () => {
    const { platform, wrapper } = setup();
    const query = { from: '2026-01-01T00:00:00Z', to: '2026-01-07T23:59:59Z' };
    const { result } = renderHook(() => useStatsSummary(query), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.getStatsSummary).toHaveBeenCalledWith(query);
    expect(result.current.data).toEqual(SUMMARY);
  });
});

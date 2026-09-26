// ────────────────────────────────────────────────────────────────
// Palette entity search hook (G-18) — `useSearch` debounces `q` by 120ms
// before it reaches `platform.search`.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { IPlatformClient, SearchResponse } from '@generatorai/shared';

import { PlatformContext } from '@/providers/PlatformProvider.js';
import { useSearch } from '@/hooks/searchQueries.js';

const RESPONSE: SearchResponse = {
  results: [{ type: 'chat', id: 'c1', title: 'Nightly chat', href: '/chats/c1', actions: ['open'] }],
};

function setup() {
  const platform = { search: vi.fn().mockResolvedValue(RESPONSE) };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>{children}</PlatformContext.Provider>
    </QueryClientProvider>
  );
  return { platform, wrapper };
}

describe('useSearch', () => {
  it('does not query for an empty string', () => {
    const { platform, wrapper } = setup();
    renderHook(() => useSearch(''), { wrapper });
    expect(platform.search).not.toHaveBeenCalled();
  });

  it('debounces a CHANGE to `q` before querying the platform', async () => {
    const { platform, wrapper } = setup();
    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(q), {
      wrapper,
      initialProps: { q: '' },
    });
    rerender({ q: 'nightly' });
    // Not yet — the 120ms debounce has not elapsed.
    expect(platform.search).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.data).toBeDefined(), { timeout: 2000 });
    expect(platform.search).toHaveBeenCalledWith({ q: 'nightly', types: undefined, limit: undefined });
    expect(result.current.data).toEqual(RESPONSE);
  });

  it('only queries once for a burst of rapid changes (only the last value lands)', async () => {
    const { platform, wrapper } = setup();
    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(q), {
      wrapper,
      initialProps: { q: '' },
    });
    rerender({ q: 'n' });
    rerender({ q: 'ni' });
    rerender({ q: 'nightly' });
    await waitFor(() => expect(result.current.data).toBeDefined(), { timeout: 2000 });
    expect(platform.search).toHaveBeenCalledTimes(1);
    expect(platform.search).toHaveBeenCalledWith({ q: 'nightly', types: undefined, limit: undefined });
  });

  it('trims whitespace before treating it as a query', () => {
    const { platform, wrapper } = setup();
    renderHook(() => useSearch('   '), { wrapper });
    expect(platform.search).not.toHaveBeenCalled();
  });

  it('forwards `types` and `limit`', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useSearch('run nig', { types: ['workflow', 'automation'], limit: 5 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined(), { timeout: 2000 });
    expect(platform.search).toHaveBeenCalledWith({ q: 'run nig', types: ['workflow', 'automation'], limit: 5 });
  });

  it('honours `enabled: false`', async () => {
    const { platform, wrapper } = setup();
    renderHook(() => useSearch('nightly', { enabled: false }), { wrapper });
    await new Promise((r) => setTimeout(r, 200));
    expect(platform.search).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────
// P1-51 — the global query defaults.
//
// `staleTime: 0` made every query in the app permanently stale, so every
// remount refetched and a single window focus refetched everything at once.
// The fix only works if invalidation still bypasses the window — otherwise a
// stale window would delay live data, which is why that is asserted here and
// not just the constant.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { queryClient, DEFAULT_STALE_TIME_MS } from '@/providers/QueryProvider.js';

describe('query defaults', () => {
  it('no longer treats every query as permanently stale', () => {
    const defaults = queryClient.getDefaultOptions().queries!;
    expect(defaults.staleTime).toBe(DEFAULT_STALE_TIME_MS);
    expect(DEFAULT_STALE_TIME_MS).toBeGreaterThan(0);
  });

  it('keeps focus refetching as the post-background recovery path', () => {
    expect(queryClient.getDefaultOptions().queries!.refetchOnWindowFocus).toBe(true);
  });

  it('a mount inside the stale window does not refetch', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: DEFAULT_STALE_TIME_MS, retry: false } },
    });
    const fn = vi.fn(async () => 'v1');
    const options = { queryKey: ['thing'], queryFn: fn };

    const first = new QueryObserver(client, options);
    const unsub1 = first.subscribe(() => {});
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    unsub1();

    const second = new QueryObserver(client, options);
    const unsub2 = second.subscribe(() => {});
    await new Promise((r) => setTimeout(r, 20));
    expect(fn).toHaveBeenCalledTimes(1);
    unsub2();
  });

  it('SSE-driven invalidation still refetches immediately despite the window', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: DEFAULT_STALE_TIME_MS, retry: false } },
    });
    const fn = vi.fn(async () => 'v1');
    const observer = new QueryObserver(client, { queryKey: ['live'], queryFn: fn });
    const unsub = observer.subscribe(() => {});
    // Wait for the first fetch to SETTLE: invalidating a query that is still
    // in flight is deduped into the fetch already running, which would make
    // this assert pass or fail on timing rather than on policy.
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));

    // This is the path every stream event takes. It must not respect staleTime.
    await client.invalidateQueries({ queryKey: ['live'] });
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
  });
});

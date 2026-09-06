// ────────────────────────────────────────────────────────────────
// Review 5.8 / plan item 6 — the global save-error handler.
//
// ~90 mutation sites and two `onError`s: a failed save looked identical to a
// successful one. These pin the cache-level fallback: every mutation without
// its own handler toasts the server's message; a mutation WITH a handler is
// left alone; background refetch failures toast once per query, not once per
// poll. Revert the `mutationCache` / `queryCache` wiring in QueryProvider and
// the first test fails.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MutationObserver, QueryObserver } from '@tanstack/react-query';
import { ApiError } from '@/platform/apiFetch.js';

const toastSpy = vi.fn();
vi.mock('@/components/Toast.js', () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
}));

const { createAppQueryClient, describeRequestError, shouldReportMutation } = await import(
  '@/providers/QueryProvider.js'
);

async function runMutation(
  client: ReturnType<typeof createAppQueryClient>,
  options: ConstructorParameters<typeof MutationObserver>[1],
) {
  const observer = new MutationObserver(client, options);
  await observer.mutate(undefined).catch(() => undefined);
}

beforeEach(() => {
  toastSpy.mockClear();
});

describe('mutationCache.onError — every save that fails says so', () => {
  it('toasts the server message for a mutation with no onError of its own', async () => {
    const client = createAppQueryClient();
    await runMutation(client, {
      mutationFn: async () => {
        throw new ApiError(409, 'CONFLICT', 'Workflow name already exists');
      },
    });
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]![0]).toMatchObject({
      variant: 'error',
      title: 'Action failed',
      description: 'Workflow name already exists',
    });
  });

  it('steps aside when the mutation declares its own onError (no double report)', async () => {
    const client = createAppQueryClient();
    const own = vi.fn();
    await runMutation(client, {
      mutationFn: async () => {
        throw new Error('boom');
      },
      onError: own,
    });
    expect(own).toHaveBeenCalledTimes(1);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('honours meta.silentError and meta.errorTitle', async () => {
    const client = createAppQueryClient();
    await runMutation(client, {
      mutationFn: async () => {
        throw new Error('quiet');
      },
      meta: { silentError: true },
    });
    expect(toastSpy).not.toHaveBeenCalled();

    await runMutation(client, {
      mutationFn: async () => {
        throw new Error('loud');
      },
      meta: { errorTitle: 'Rename failed' },
    });
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]![0]).toMatchObject({ title: 'Rename failed', description: 'loud' });
  });

  it('does not toast a mutation that succeeds', async () => {
    const client = createAppQueryClient();
    await runMutation(client, { mutationFn: async () => 'ok' });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('shouldReportMutation is the single decision point', () => {
    expect(shouldReportMutation({ options: {} } as never)).toBe(true);
    expect(shouldReportMutation({ options: { onError: () => {} } } as never)).toBe(false);
    expect(shouldReportMutation({ options: { meta: { silentError: true } } } as never)).toBe(false);
  });
});

describe('describeRequestError', () => {
  it('prefers the server body, then Error.message, then the fallback', () => {
    expect(describeRequestError(new ApiError(400, 'BAD', 'Name is required'))).toBe('Name is required');
    expect(describeRequestError(new ApiError(502, 'BAD_GATEWAY', ''))).toBe('The request failed. (HTTP 502)');
    expect(describeRequestError(new Error('network down'))).toBe('network down');
    expect(describeRequestError(undefined)).toBe('The request failed.');
    expect(describeRequestError(null, 'Could not load the workflow.')).toBe('Could not load the workflow.');
  });
});

describe('queryCache.onError — background refetch failures', () => {
  it('does not toast an initial load failure (the page renders that itself)', async () => {
    const client = createAppQueryClient();
    const observer = new QueryObserver(client, {
      queryKey: ['initial-fail'],
      queryFn: async () => {
        throw new Error('404');
      },
      retry: false,
    });
    const unsub = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    unsub();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('toasts ONCE when a query that already has data fails repeatedly, then again after it recovers', async () => {
    const client = createAppQueryClient();
    let mode: 'ok' | 'fail' = 'ok';
    let calls = 0;
    const observer = new QueryObserver(client, {
      queryKey: ['poll'],
      queryFn: async () => {
        calls += 1;
        if (mode === 'fail') throw new ApiError(503, 'UNAVAILABLE', 'Server restarting');
        return `v${calls}`;
      },
      retry: false,
      staleTime: 0,
    });
    const unsub = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));

    mode = 'fail';
    await observer.refetch();
    await observer.refetch();
    await observer.refetch();
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]![0]).toMatchObject({
      variant: 'warning',
      title: "Couldn't refresh",
    });
    expect(String(toastSpy.mock.calls[0]![0].description)).toContain('Server restarting');

    // Recovery releases the latch; the next outage is news again.
    mode = 'ok';
    await observer.refetch();
    mode = 'fail';
    await observer.refetch();
    expect(toastSpy).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('respects meta.silentError on queries', async () => {
    const client = createAppQueryClient();
    let fail = false;
    const observer = new QueryObserver(client, {
      queryKey: ['silent'],
      queryFn: async () => {
        if (fail) throw new Error('nope');
        return 'data';
      },
      retry: false,
      staleTime: 0,
      meta: { silentError: true },
    });
    const unsub = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    fail = true;
    await observer.refetch();
    expect(toastSpy).not.toHaveBeenCalled();
    unsub();
  });
});

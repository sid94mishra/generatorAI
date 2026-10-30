// ────────────────────────────────────────────────────────────────
// useAttention — the G-01 web hook.
//
// The snapshot comes from `platform.getAttention`; `attention.*` deltas on
// the shared `global` subscription are folded in by client-core's
// `createAttentionStore` (one store per platform + project).
// Pinned here: the subscription shape, delta application, buffering of
// deltas that beat the first snapshot, refetch on a seq gap / resync /
// reconnect, the project filter, and that counts stay undefined until
// loaded (no made-up zero).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyAttentionCounts, type AttentionItem, type AttentionSnapshot, type IPlatformClient } from '@generatorai/shared';

import type { MuxHandlers } from '@/platform/muxStream.js';

const subs: Array<{ scope: string; id: string; handlers: MuxHandlers; filter?: readonly string[]; closed: boolean }> = [];
vi.mock('@/platform/muxStream.js', () => ({
  openMultiplexedStream: (scope: string, id: string, handlers: MuxHandlers, filter?: readonly string[]) => {
    const sub = { scope, id, handlers, filter, closed: false };
    subs.push(sub);
    return {
      close: () => {
        sub.closed = true;
      },
    };
  },
}));

import { PlatformContext } from '@/providers/PlatformProvider.js';
import { useAttention, useAttentionCounts } from '@/hooks/attentionQueries.js';
import { MockPlatformClient } from '../helpers/MockPlatformClient.js';

const item = (key: string, over: Partial<AttentionItem> = {}): AttentionItem => ({
  key,
  entity: 'chat',
  entityId: key.split(':')[1]!,
  title: key,
  href: `/chats/${key.split(':')[1]}`,
  state: 'running',
  since: '2026-09-26T10:00:00.000Z',
  stoppable: true,
  ...over,
});

const snap = (seq: number, running: AttentionItem[] = [], needsYou: AttentionItem[] = []): AttentionSnapshot => ({
  seq,
  generatedAt: '2026-09-26T10:00:00.000Z',
  needsYou,
  running,
  counts: { ...emptyAttentionCounts(), needsYou: needsYou.length, running: running.length },
});

function frame(kind: string, payload: unknown) {
  return { lastEventId: '1', data: JSON.stringify({ kind, payload }) };
}

function setup(snapshots: AttentionSnapshot[] | (() => Promise<AttentionSnapshot>)) {
  const platform = new MockPlatformClient();
  const queue = Array.isArray(snapshots) ? [...snapshots] : null;
  platform.getAttention.mockImplementation(
    queue ? async () => (queue.length > 1 ? queue.shift()! : queue[0]!) : (snapshots as () => Promise<AttentionSnapshot>),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>{children}</PlatformContext.Provider>
    </QueryClientProvider>
  );
  return { platform, queryClient, wrapper };
}

afterEach(() => {
  subs.length = 0;
  vi.clearAllMocks();
});

describe('useAttention', () => {
  it('loads the snapshot and folds live deltas into it', async () => {
    const { platform, wrapper } = setup([snap(10, [item('chat:a')])]);
    const { result, unmount } = renderHook(() => useAttention(), { wrapper });

    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ scope: 'global', id: 'all', filter: ['attention.'] });
    await waitFor(() => expect(result.current.data?.seq).toBe(10));
    expect(platform.getAttention).toHaveBeenCalledWith(undefined);

    act(() => {
      subs[0]!.handlers.onMessage?.(frame('attention.upsert', { seq: 11, item: item('chat:b') }));
      subs[0]!.handlers.onMessage?.(frame('attention.remove', { seq: 12, key: 'chat:a' }));
      subs[0]!.handlers.onMessage?.(frame('chat.created', { chatId: 'x' }));
    });
    await waitFor(() => expect(result.current.data?.seq).toBe(12));
    expect(result.current.data!.running.map((i) => i.key)).toEqual(['chat:b']);
    expect(result.current.data!.counts.byEntity.chat.running).toBe(1);

    unmount();
    expect(subs[0]!.closed).toBe(true);
  });

  it('replays deltas that arrive before the first snapshot', async () => {
    let resolve!: (s: AttentionSnapshot) => void;
    const { wrapper } = setup(() => new Promise<AttentionSnapshot>((r) => (resolve = r)));
    const { result } = renderHook(() => useAttention(), { wrapper });
    await waitFor(() => expect(subs).toHaveLength(1));

    act(() => {
      subs[0]!.handlers.onMessage?.(frame('attention.upsert', { seq: 4, item: item('chat:old') }));
      subs[0]!.handlers.onMessage?.(frame('attention.upsert', { seq: 5, item: item('chat:new') }));
    });
    await act(async () => resolve(snap(4, [item('chat:old')])));

    await waitFor(() => expect(result.current.data?.seq).toBe(5));
    expect(result.current.data!.running.map((i) => i.key)).toEqual(['chat:new', 'chat:old']);
  });

  it('refetches on a seq gap, a resync and a reconnect after an error', async () => {
    const { platform, wrapper } = setup([snap(1), snap(50), snap(60), snap(70)]);
    const { result } = renderHook(() => useAttention(), { wrapper });
    await waitFor(() => expect(result.current.data?.seq).toBe(1));

    act(() => subs[0]!.handlers.onMessage?.(frame('attention.upsert', { seq: 9, item: item('chat:x') })));
    await waitFor(() => expect(result.current.data?.seq).toBe(50));

    act(() => subs[0]!.handlers.onResync?.('gap'));
    await waitFor(() => expect(result.current.data?.seq).toBe(60));

    act(() => subs[0]!.handlers.onOpen?.()); // not after an error: nothing to repair
    act(() => {
      subs[0]!.handlers.onError?.(null);
      subs[0]!.handlers.onOpen?.();
    });
    await waitFor(() => expect(result.current.data?.seq).toBe(70));
    expect(platform.getAttention).toHaveBeenCalledTimes(4);
  });

  it('passes the project filter and drops deltas for other projects', async () => {
    const inP1 = item('chat:a', { project: { id: 'p1', name: 'Web' } });
    const { platform, wrapper } = setup([snap(1, [inP1])]);
    const { result } = renderHook(() => useAttention({ projectId: 'p1' }), { wrapper });
    await waitFor(() => expect(result.current.data?.seq).toBe(1));
    expect(platform.getAttention).toHaveBeenCalledWith({ projectId: 'p1' });

    act(() =>
      subs[0]!.handlers.onMessage?.(
        frame('attention.upsert', { seq: 2, item: item('chat:b', { project: { id: 'p2', name: 'Api' } }) }),
      ),
    );
    await waitFor(() => expect(result.current.data?.seq).toBe(2));
    expect(result.current.data!.running.map((i) => i.key)).toEqual(['chat:a']);
  });
});

describe('useAttention — shared store (P2-R12)', () => {
  it('two consumers share one subscription and one request; the store stops with the last one', async () => {
    const { platform, wrapper } = setup([snap(1, [item('chat:a')])]);
    const a = renderHook(() => useAttention(), { wrapper });
    const b = renderHook(() => useAttentionCounts(), { wrapper });
    await waitFor(() => expect(b.result.current).toMatchObject({ running: 1 }));
    expect(subs).toHaveLength(1);
    expect(platform.getAttention).toHaveBeenCalledTimes(1);
    a.unmount();
    expect(subs[0]!.closed).toBe(false);
    b.unmount();
    expect(subs[0]!.closed).toBe(true);
  });

  it('a delta burst during a refetch neither cancels nor repeats it, and nothing is lost', async () => {
    const resolvers: Array<(s: AttentionSnapshot) => void> = [];
    const { platform, wrapper } = setup(() => new Promise<AttentionSnapshot>((r) => resolvers.push(r)));
    const { result } = renderHook(() => useAttention(), { wrapper });
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => resolvers.shift()!(snap(1)));
    await waitFor(() => expect(result.current.data?.seq).toBe(1));

    act(() => subs[0]!.handlers.onMessage?.(frame('attention.upsert', { seq: 5, item: item('chat:gap') }))); // 2–4 lost
    await waitFor(() => expect(platform.getAttention).toHaveBeenCalledTimes(2));
    act(() => {
      for (let seq = 6; seq <= 40; seq++) {
        subs[0]!.handlers.onMessage?.(frame('attention.upsert', { seq, item: item(`chat:n${seq}`) }));
      }
    });
    expect(platform.getAttention).toHaveBeenCalledTimes(2);
    await act(async () => resolvers.shift()!(snap(5, [item('chat:gap')])));
    await waitFor(() => expect(result.current.data?.seq).toBe(40));
    expect(result.current.data!.running).toHaveLength(36);
    expect(platform.getAttention).toHaveBeenCalledTimes(2);
  });
});

describe('useAttentionCounts', () => {
  it('is undefined until loaded, then the snapshot counts', async () => {
    const { wrapper } = setup([snap(3, [item('chat:a')], [item('chat:b:i1', { state: 'needs_you' })])]);
    const { result } = renderHook(() => useAttentionCounts(), { wrapper });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toMatchObject({ needsYou: 1, running: 1 }));
  });
});

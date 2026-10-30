// ────────────────────────────────────────────────────────────────
// Chat list hooks — the G-02 / G-14 web hooks.
//
// Pinned here: the query reaches the platform client unchanged (G-14's
// `useChats({ projectId })` included); infinite paging follows `nextCursor`
// and merges pages; the list is kept live by one `global` subscription whose
// filter follows the query (attention kinds only for a live-state filter) and
// whose events invalidate the query instead of a poll; bulk actions are one
// request and reject with the per-id outcome on a partial failure.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatListItem, ChatListPage, IPlatformClient } from '@generatorai/shared';

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
import {
  ChatBulkError,
  useBulkArchiveChats,
  useBulkDeleteChats,
  useChatPages,
  useChats,
} from '@/hooks/chatListQueries.js';
import { MockPlatformClient } from '../helpers/MockPlatformClient.js';

const row = (id: string): ChatListItem =>
  ({
    id,
    name: `Chat ${id}`,
    sessionId: `s-${id}`,
    status: 'active',
    tags: [],
    createdAt: '2026-09-26T09:00:00.000Z',
    updatedAt: '2026-09-26T09:00:00.000Z',
    summary: { lastActivityAt: '2026-09-26T10:00:00.000Z' },
  }) as unknown as ChatListItem;

const page = (ids: string[], nextCursor: string | null, total = 5): ChatListPage => ({
  items: ids.map(row),
  nextCursor,
  total,
  counts: { all: total + 1, active: total, archived: 1 },
});

function frame(kind: string) {
  return { lastEventId: '1', data: JSON.stringify({ kind, payload: { chatId: 'x' } }) };
}

function setup() {
  const platform = new MockPlatformClient();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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

describe('useChats', () => {
  it('asks for one page with the query as given (G-14: projectId)', async () => {
    const { platform, wrapper } = setup();
    platform.listChats.mockResolvedValue(page(['a', 'b'], 'c1'));
    const { result } = renderHook(() => useChats({ projectId: 'p1', status: 'active' }), { wrapper });

    await waitFor(() => expect(result.current.data?.items).toHaveLength(2));
    expect(platform.listChats).toHaveBeenCalledWith({ projectId: 'p1', status: 'active' });
    expect(result.current.data).toMatchObject({ total: 5, counts: { all: 6, active: 5, archived: 1 } });
  });

  it('stays live through one global subscription instead of polling', async () => {
    const { platform, wrapper } = setup();
    platform.listChats.mockResolvedValue(page(['a'], null));
    const { result, unmount } = renderHook(() => useChats(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      scope: 'global',
      id: 'all',
      filter: ['chat.created', 'chat.updated', 'chat.archived', 'chat.deleted'],
    });
    expect(platform.listChats).toHaveBeenCalledTimes(1);

    // Not a list event: ignored.
    act(() => subs[0]!.handlers.onMessage?.(frame('attention.upsert')));
    act(() => subs[0]!.handlers.onMessage?.(frame('chat.updated')));
    await waitFor(() => expect(platform.listChats).toHaveBeenCalledTimes(2));

    act(() => subs[0]!.handlers.onResync?.('gap'));
    await waitFor(() => expect(platform.listChats).toHaveBeenCalledTimes(3));

    unmount();
    expect(subs[0]!.closed).toBe(true);
  });

  it('P2-R20: folds a 200-event burst into one refetch and never cancels the request in flight', async () => {
    const { platform, wrapper } = setup();
    const resolvers: Array<(p: ChatListPage) => void> = [];
    platform.listChats.mockResolvedValueOnce(page(['a'], null));
    const { result } = renderHook(() => useChats(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    platform.listChats.mockImplementation(() => new Promise<ChatListPage>((r) => resolvers.push(r)));

    act(() => {
      for (let i = 0; i < 200; i++) subs[0]!.handlers.onMessage?.(frame('chat.archived'));
    });
    await waitFor(() => expect(platform.listChats).toHaveBeenCalledTimes(2));
    // More events while that request is in flight: it is not cancelled …
    act(() => {
      for (let i = 0; i < 50; i++) subs[0]!.handlers.onMessage?.(frame('chat.archived'));
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(platform.listChats).toHaveBeenCalledTimes(2);
    // … and exactly one more follows it, so the last change is not missed.
    await act(async () => resolvers.shift()!(page(['b'], null)));
    await waitFor(() => expect(platform.listChats).toHaveBeenCalledTimes(3));
    await act(async () => resolvers.shift()!(page(['c'], null)));
    await waitFor(() => expect(result.current.data?.items.map((i) => i.id)).toEqual(['c']));
    expect(platform.listChats).toHaveBeenCalledTimes(3);
  });

  it('follows the attention feed only when filtering on a live state', async () => {
    const { platform, wrapper } = setup();
    platform.listChats.mockResolvedValue(page(['a'], null));
    const { result } = renderHook(() => useChats({ state: ['running', 'done'] }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(subs[0]!.filter).toEqual([
      'chat.created',
      'chat.updated',
      'chat.archived',
      'chat.deleted',
      'attention.upsert',
      'attention.remove',
    ]);
    act(() => subs[0]!.handlers.onMessage?.(frame('attention.remove')));
    await waitFor(() => expect(platform.listChats).toHaveBeenCalledTimes(2));
  });
});

describe('useChatPages', () => {
  it('follows nextCursor and merges pages, dropping a row seen twice', async () => {
    const { platform, wrapper } = setup();
    platform.listChats
      .mockResolvedValueOnce(page(['a', 'b'], 'cursor-1'))
      .mockResolvedValueOnce(page(['b', 'c'], null, 4));
    const { result } = renderHook(() => useChatPages({ q: 'deploy' }), { wrapper });

    await waitFor(() => expect(result.current.data?.items.map((c) => c.id)).toEqual(['a', 'b']));
    expect(result.current.hasNextPage).toBe(true);
    expect(platform.listChats).toHaveBeenLastCalledWith({ q: 'deploy' });

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.items.map((c) => c.id)).toEqual(['a', 'b', 'c']));
    expect(platform.listChats).toHaveBeenLastCalledWith({ q: 'deploy', cursor: 'cursor-1' });
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.data?.total).toBe(4);
  });

  it('P2-R34: an event during an in-flight fetchNextPage still leads to a full refetch after it', async () => {
    const { platform, wrapper } = setup();
    platform.listChats.mockResolvedValueOnce(page(['a', 'b'], 'cursor-1'));
    const { result } = renderHook(() => useChatPages(), { wrapper });
    await waitFor(() => expect(result.current.data?.items.map((c) => c.id)).toEqual(['a', 'b']));

    // The next page is slow; while it is in flight a list event lands.
    let resolveNext!: (p: ChatListPage) => void;
    platform.listChats.mockImplementationOnce(() => new Promise<ChatListPage>((r) => (resolveNext = r)));
    let nextPage!: Promise<unknown>;
    act(() => {
      nextPage = result.current.fetchNextPage();
    });
    await waitFor(() => expect(platform.listChats).toHaveBeenCalledTimes(2));
    expect(platform.listChats).toHaveBeenLastCalledWith({ cursor: 'cursor-1' });

    // The first page changed on the server (a new chat 'z').
    platform.listChats.mockImplementation(async (q?: { cursor?: string }) =>
      q?.cursor ? page(['c'], null) : page(['z', 'a'], 'cursor-2'),
    );
    act(() => subs[0]!.handlers.onMessage?.(frame('chat.created')));
    // The coalescing window passes while fetchNextPage is still in flight:
    // the invalidate only joins it, and nothing new is requested yet.
    await new Promise((r) => setTimeout(r, 400));
    expect(platform.listChats).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveNext(page(['c'], null));
      await nextPage;
    });
    // After it settles, a real refetch reloads the list from its first page.
    await waitFor(() => expect(result.current.data?.items.map((c) => c.id)).toEqual(['z', 'a', 'c']));
    expect(platform.listChats.mock.calls.slice(2).map(([q]) => q)).toEqual([{}, { cursor: 'cursor-2' }]);
  });
});

describe('bulk actions', () => {
  it('archives in one request', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useBulkArchiveChats(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(['a', 'b']);
    });
    expect(platform.archiveChats).toHaveBeenCalledWith(['a', 'b']);
    expect(platform.deleteChat).not.toHaveBeenCalled();
  });

  it('rejects with the per-id outcome when some ids fail', async () => {
    const { platform, wrapper } = setup();
    platform.deleteChats.mockResolvedValueOnce({
      succeeded: ['a'],
      failed: [{ id: 'b', code: 'NOT_FOUND', message: 'Chat not found: b' }],
    });
    const { result } = renderHook(() => useBulkDeleteChats(), { wrapper });
    let error: unknown;
    await act(async () => {
      error = await result.current.mutateAsync(['a', 'b']).catch((e: unknown) => e);
    });
    expect(error).toBeInstanceOf(ChatBulkError);
    expect((error as ChatBulkError).message).toBe('Failed to delete 1 of 2 chats');
    expect((error as ChatBulkError).result.failed[0]!.id).toBe('b');
  });
});

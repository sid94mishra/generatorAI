// ────────────────────────────────────────────────────────────────
// Chat list hooks (G-02 / G-14) — `GET /api/chats`, paged and live.
//
//   useChats(query)       one page (default 50 rows): the
//                         ProjectDetail Chats tab (`useChats({ projectId })`,
//                         G-14), the palette's recent chats.
//   useChatPages(query)   every page loaded so far, for the list's infinite
//                         scroll; `data` is the merged list (duplicates from
//                         rows that moved between loads are dropped).
//   useBulkArchiveChats / useBulkDeleteChats   any number of ids (the
//                         platform client batches them under the server's
//                         cap); a partial failure rejects with the per-id
//                         outcome attached.
//
// Live: instead of polling, each hook holds one `global` subscription on the
// shared multiplexed stream for the kinds that make a list stale
// (`chat.created|updated|archived|deleted`, plus `attention.*` when the query
// filters on a live state) and invalidates its query — the same rules
// mobile applies through client-core's `chatListInvalidatedBy`. A burst of
// events is folded into one refetch per 250 ms, and a request in flight is
// never cancelled.
//
// Status column: combine a row with the attention feed via client-core's
// `chatRowState(row, chatLiveSets(useAttention().data))`.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  chatListInvalidatedBy,
  chatListKey,
  chatListStreamFilter,
  mergeChatListPages,
} from '@generatorai/client-core';
import type { ChatBulkResult, ChatListItem, ChatListPage, ChatListQuery } from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';
import { openMultiplexedStream } from '../platform/muxStream.js';

/** Under `['chats']`, so every existing `queryKeys.chats` invalidation refreshes lists too. */
export const chatListKeys = {
  all: ['chats', 'list'] as const,
  page: (query: ChatListQuery) => ['chats', 'list', 'page', chatListKey(query)] as const,
  pages: (query: ChatListQuery) => ['chats', 'list', 'pages', chatListKey(query)] as const,
};

/** Kind of one multiplexed frame body (`{"kind":…,"payload":…}`). */
function frameKind(raw: string): string | null {
  try {
    const frame = JSON.parse(raw) as { kind?: unknown };
    return typeof frame.kind === 'string' ? frame.kind : null;
  } catch {
    return null;
  }
}

/** Trailing window that folds a burst of list events (a 200-id bulk archive) into one refetch. */
const LIVE_REFETCH_WINDOW_MS = 250;

/**
 * Refetches `key` at most once per window, never cancelling a request in
 * flight: a burst of events faster than one round trip would otherwise
 * cancel every response before it landed (P2-R20). An event that arrives
 * while a refetch is running — ours or any other fetch of the query, such as
 * `fetchNextPage` — queues exactly one more after it, so the last change is
 * never missed.
 */
function coalescedRefetch(queryClient: QueryClient, key: readonly unknown[]) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let dirty = false;
  let disposed = false;
  const run = async (): Promise<void> => {
    timer = null;
    if (disposed) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      do {
        // With `cancelRefetch: false` an invalidate joins whatever fetch is
        // already in flight — a `fetchNextPage` that reloads one page, or a
        // refetch that left before this event. Wait for it, then refetch for
        // real, so the event is not lost until the next one (P2-R34).
        dirty = queryClient.getQueryState(key)?.fetchStatus === 'fetching';
        await queryClient.invalidateQueries({ queryKey: key, exact: true }, { cancelRefetch: false });
      } while (dirty && !disposed);
    } finally {
      running = false;
    }
  };
  return {
    schedule(): void {
      if (!timer) timer = setTimeout(() => void run(), LIVE_REFETCH_WINDOW_MS);
    },
    now(): void {
      if (timer) clearTimeout(timer);
      void run();
    },
    dispose(): void {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Invalidates `key` whenever the `global` stream says a list for `query` went stale. */
function useLiveChatList(query: ChatListQuery, key: readonly unknown[], enabled: boolean): void {
  const queryClient = useQueryClient();
  const serialized = JSON.stringify(key);
  useEffect(() => {
    if (!enabled) return;
    const refetch = coalescedRefetch(queryClient, JSON.parse(serialized) as unknown[]);
    let lostConnection = false;
    const handle = openMultiplexedStream(
      'global',
      'all',
      {
        onMessage: (message) => {
          const kind = frameKind(message.data);
          if (kind && chatListInvalidatedBy(kind, query)) refetch.schedule();
        },
        // Events were missed (no replay from our cursor, or a reconnect).
        onResync: () => refetch.now(),
        onError: () => {
          lostConnection = true;
        },
        onOpen: () => {
          if (lostConnection) {
            lostConnection = false;
            refetch.now();
          }
        },
      },
      chatListStreamFilter(query),
    );
    return () => {
      handle.close();
      refetch.dispose();
    };
    // `serialized` covers `query`: the key is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, serialized, queryClient]);
}

export interface UseChatListOptions {
  enabled?: boolean;
}

/** One page of chats (default 50, newest activity first). Worker chats are left out unless `workers: true`. */
export function useChats(query: ChatListQuery = {}, options: UseChatListOptions = {}) {
  const platform = usePlatform();
  const enabled = options.enabled !== false;
  const key = chatListKeys.page(query);
  useLiveChatList(query, key, enabled);
  return useQuery({
    queryKey: key,
    queryFn: () => platform.listChats(query),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/**
 * Every page loaded so far, merged. `fetchNextPage()` loads the next one;
 * `hasNextPage` is false on the last. `data.total` / `data.counts` describe
 * the whole filtered list, not just what is loaded.
 */
export function useChatPages(query: Omit<ChatListQuery, 'cursor'> = {}, options: UseChatListOptions = {}) {
  const platform = usePlatform();
  const enabled = options.enabled !== false;
  const key = chatListKeys.pages(query);
  useLiveChatList(query, key, enabled);
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => platform.listChats(pageParam ? { ...query, cursor: pageParam } : query),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ChatListPage) => last.nextCursor,
    select: (data) => mergeChatListPages<ChatListItem>(data.pages),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** A bulk action where some ids failed. `result` says which. */
export class ChatBulkError extends Error {
  constructor(
    readonly result: ChatBulkResult,
    verb: string,
  ) {
    super(`Failed to ${verb} ${result.failed.length} of ${result.failed.length + result.succeeded.length} chats`);
    this.name = 'ChatBulkError';
  }
}

function useBulkChatAction(
  run: (ids: string[]) => Promise<ChatBulkResult>,
  verb: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (chatIds: string[]) => {
      const result = await run(chatIds);
      if (result.failed.length > 0) throw new ChatBulkError(result, verb);
      return result;
    },
    // Some ids may have gone through even when others failed.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

/** Archive any number of chats (the list's bulk bar). */
export function useBulkArchiveChats() {
  const platform = usePlatform();
  return useBulkChatAction((ids) => platform.archiveChats(ids), 'archive');
}

/** Permanently delete any number of chats. */
export function useBulkDeleteChats() {
  const platform = usePlatform();
  return useBulkChatAction((ids) => platform.deleteChats(ids), 'delete');
}

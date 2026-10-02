// Chats data (MChats, M6-01): the server-paged list (G-02, keyset cursor, server search, counts per segment),
// joined with the live attention sets (`chatRowState`) and the project names, as ChatRow views (MB-48).
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { chatListKey, chatLiveSets, mergeChatListPages, queryKeys, toChatRowModel } from '@generatorai/client-core';
import type { ChatListQuery } from '@generatorai/shared';

import { chatRowView, type ChatRowView, type ChatSort } from '../../blocks/ChatRow';
import { useApi } from '../../services/api/useApi';
import { useAttention } from '../../services/stream/AttentionProvider';

export type ChatScope = 'all' | 'active' | 'archived';

/** Project names for the rows' meta (the list API carries only `projectId`); the Projects screen's cache key. */
function useProjectNames(): ReadonlyMap<string, string> {
  const api = useApi();
  const projects = useQuery({ queryKey: [...queryKeys.projects(), 'summary'], meta: { persist: true }, queryFn: () => api.projects.list({ includeSummary: true }), staleTime: 60_000 });
  return useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
}

export interface ChatsList {
  rows: ChatRowView[];
  counts: { all: number; active: number; archived: number } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => Promise<unknown>;
}

export function useChatsList(scope: ChatScope, search: string, sort: ChatSort): ChatsList {
  const api = useApi();
  const attention = useAttention();
  const names = useProjectNames();
  const query: ChatListQuery = { ...(scope === 'all' ? {} : { status: scope }), q: search.trim(), sort, limit: 50 };
  const result = useInfiniteQuery({
    queryKey: [...queryKeys.chats(), chatListKey(query)],
    meta: { persist: true },
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.chats.list({ ...query, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const merged = useMemo(() => mergeChatListPages(result.data?.pages ?? []), [result.data]);
  const live = useMemo(() => chatLiveSets(attention.snapshot), [attention.snapshot]);
  const rows = useMemo(
    () => (merged?.items ?? []).map((item) => chatRowView(toChatRowModel(item, live, item.projectId ? names.get(item.projectId) : undefined))),
    [merged, live, names],
  );
  return {
    rows,
    counts: merged?.counts,
    isLoading: result.isLoading,
    isError: result.isError,
    error: result.error,
    hasNextPage: result.hasNextPage,
    isFetchingNextPage: result.isFetchingNextPage,
    fetchNextPage: () => void result.fetchNextPage(),
    refetch: result.refetch,
  };
}

// Home data (MHome, MHomeMore; M7-01): Needs you / Running from the attention store (G-01, live), Recently finished
// and the "Finished today" count from `activity.recent` (G-11; PR / commit outcomes MG-13), refreshed when an
// attention item leaves the feed (it just finished). The week strip and the server footer read MB-40's hooks.
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecentActivityItem } from '@generatorai/shared';

import { useAttentionLists } from '../../blocks/AttentionList';
import { useApi } from '../../services/api/useApi';
import { useAttention } from '../../services/stream/AttentionProvider';
import { useMuxStream } from '../../services/stream/MuxStreamProvider';
import { HOME_RECENT_LIMIT, finishedTodayCount, startOfToday } from './homeModel';

const RECENT_KEY = ['activity', 'recent'] as const;
/** Enough for a busy day; the tile reads "99+" beyond it. */
const TODAY_LIMIT = 100;

export function useHomeData() {
  const api = useApi();
  const attention = useAttention();
  const lists = useAttentionLists();
  const stream = useMuxStream();
  const client = useQueryClient();
  const today = startOfToday().toISOString();

  const recent = useQuery({
    queryKey: [...RECENT_KEY, 'home'],
    meta: { persist: true },
    queryFn: () => api.activity.recent({ limit: HOME_RECENT_LIMIT }),
    staleTime: 30_000,
  });
  const todays = useQuery({
    queryKey: [...RECENT_KEY, 'today', today],
    meta: { persist: true },
    queryFn: () => api.activity.recent({ since: today, limit: TODAY_LIMIT }),
    staleTime: 30_000,
  });

  // A finished item leaves the attention feed: re-read what just finished and the week's numbers.
  useEffect(
    () =>
      stream?.subscribe('global', 'all', () => {
        void client.invalidateQueries({ queryKey: RECENT_KEY });
        void client.invalidateQueries({ queryKey: ['stats'] });
      }, { filter: ['attention.remove'] }),
    [stream, client],
  );

  const recentItems: readonly RecentActivityItem[] = recent.data?.items ?? [];
  const finishedToday = useMemo(() => (todays.data ? finishedTodayCount(todays.data.items) : null), [todays.data]);

  return {
    needsYou: lists.needsYou,
    running: lists.running,
    attentionLoaded: lists.loaded,
    attentionError: attention.error,
    recent: recentItems,
    recentLoaded: recent.data !== undefined,
    recentError: recent.isError ? recent.error : null,
    finishedToday,
    finishedTodayCapped: (todays.data?.items.length ?? 0) >= TODAY_LIMIT,
    refetch: async (): Promise<void> => {
      await Promise.all([attention.refresh(), recent.refetch(), todays.refetch(), client.invalidateQueries({ queryKey: ['stats'] })]);
    },
  };
}

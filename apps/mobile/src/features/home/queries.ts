import { useEffect, useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';
import { useApi } from '../../services/api/useApi';
import { useAttention } from '../../services/stream/AttentionProvider';
import { useMuxStream } from '../../services/stream/MuxStreamProvider';
import { weekRange } from './weekRange';
import { activityOperations } from './activityView';

export { filterOperations, groupApprovals, needsYouCount, type ActivityFilter, type ApprovalGroups, type GateInfo, type Operation, type OperationKind } from '../../services/api/activityRanking';

export function useActivity() {
  const api = useApi();
  const attention = useAttention();
  const stream = useMuxStream();
  const client = useQueryClient();
  const [health, chats, automations, summary, recent] = useQueries({ queries: [
    { queryKey: queryKeys.health(), queryFn: () => api.health(), refetchInterval: 10_000 },
    // Legacy module-count tiles use server counts, not the loaded page size.
    { queryKey: [...queryKeys.chats(), 'counts'], queryFn: () => api.chats.list({ limit: 1 }) },
    { queryKey: queryKeys.automations(), queryFn: () => api.automations.list(), refetchInterval: 30_000 },
    { queryKey: ['stats', 'week', weekRange().from], queryFn: () => api.stats.summary(weekRange()), refetchInterval: 60_000 },
    { queryKey: ['activity', 'recent'], queryFn: () => api.activity.recent({ limit: 50 }) },
  ] });
  useEffect(() => stream?.subscribe('global', 'all', () => {
    void client.invalidateQueries({ queryKey: ['activity', 'recent'] });
    void client.invalidateQueries({ queryKey: ['stats'] });
  }, { filter: ['attention.remove'] }), [stream, client]);
  const operations = useMemo(() => activityOperations(attention.snapshot, recent.data?.items ?? []), [attention.snapshot, recent.data]);
  const results = [health, chats, automations, recent];
  return {
    operations, health: health.data, summary: summary.data, summaryError: summary.error,
    counts: {
      chats: chats.data?.counts.active ?? 0,
      automations: automations.data?.length ?? 0,
      attention: attention.snapshot?.counts.needsYou ?? 0,
      running: attention.snapshot?.counts.running ?? 0,
    },
    isLoading: (!attention.snapshot && !attention.error) || results.some((result) => result.isLoading),
    isError: Boolean(attention.error) || results.some((result) => result.isError),
    isFetching: attention.fetching || results.some((result) => result.isFetching),
    refetch: () => {
      void attention.refresh();
      for (const result of [...results, summary]) void result.refetch();
    },
  };
}

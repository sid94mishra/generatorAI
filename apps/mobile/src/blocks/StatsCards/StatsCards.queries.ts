// MB-40 data: the stats summary for a range (G-10) and the server's system info (G-12).
import { useQuery } from '@tanstack/react-query';
import type { StatsSummaryQuery } from '@generatorai/shared';

import { useApi } from '../../services/api/useApi';

export function useStatsSummary(query: StatsSummaryQuery, opts: { enabled?: boolean } = {}) {
  const api = useApi();
  // The range's end moves every call; key on its start and scope so a refetch reuses the cache entry.
  const key = { from: query.from, projectId: query.projectId, automationId: query.automationId, definitionId: query.definitionId, groupBy: query.groupBy };
  return useQuery({
    queryKey: ['stats', 'summary', key],
    meta: { persist: true },
    queryFn: () => api.stats.summary(query),
    staleTime: 60_000,
    enabled: opts.enabled ?? true,
  });
}

export function useSystemInfo() {
  const api = useApi();
  return useQuery({ queryKey: ['system', 'info'], meta: { persist: true }, queryFn: () => api.system.info(), staleTime: 30_000 });
}

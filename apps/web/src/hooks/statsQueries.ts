// ────────────────────────────────────────────────────────────────
// Stats summary hook (G-10) — Home "This week", Workflows stat strip,
// AutomationDetail's stat row, WorkflowDetail's rail.
//
// The caller computes `from`/`to` in its own local time zone (the week
// starts per locale) — this hook does not guess a default range. There is
// no SSE for this endpoint: invalidate `statsKeys.summary` on the `global`
// scope's `attention.remove` and lifecycle events from the feature that
// renders the stat.
// ────────────────────────────────────────────────────────────────

import { useQuery } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';

export interface StatsSummaryQuery {
  from: string;
  to: string;
  projectId?: string;
  definitionId?: string;
  automationId?: string;
  groupBy?: 'definition';
}

export const statsKeys = {
  summary: (query: StatsSummaryQuery) => ['stats-summary', query] as const,
};

export function useStatsSummary(query: StatsSummaryQuery | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: statsKeys.summary(query ?? { from: '', to: '' }),
    queryFn: () => platform.getStatsSummary(query!),
    enabled: !!query,
    staleTime: 60_000,
  });
}

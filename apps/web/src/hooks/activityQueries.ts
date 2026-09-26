// ────────────────────────────────────────────────────────────────
// Recently finished activity hook (G-11) — Home "Recently finished".
//
// Merges chats' finished turns, terminal workflow runs and terminal
// automation executions into one feed, newest first. Pull-request- and
// commit-derived items are not built in this pass (see
// `packages/shared/src/types/RecentActivity.ts`). No SSE: invalidate
// `activityKeys.recent` on the same `global` lifecycle events the
// attention feed (G-01) already listens to.
// ────────────────────────────────────────────────────────────────

import { useQuery } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';

export interface RecentActivityQuery {
  since?: string;
  limit?: number;
  projectId?: string;
}

export const activityKeys = {
  recent: (query?: RecentActivityQuery) => ['activity-recent', query ?? {}] as const,
};

export function useRecentActivity(query?: RecentActivityQuery) {
  const platform = usePlatform();
  return useQuery({
    queryKey: activityKeys.recent(query),
    queryFn: () => platform.getRecentActivity(query),
    staleTime: 30_000,
  });
}

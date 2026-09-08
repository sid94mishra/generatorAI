// ────────────────────────────────────────────────────────────────
// useChangesSummary — the workspace change stats, shared with the pane.
//
// Keyed EXACTLY as `workbench/ChangesSection.tsx` keys its own query
// (`[...queryKeys.changes(id), base]` with the default base), so the tray
// above the composer, the strip's "Changes 3" count and the pane itself read
// one cache entry and never disagree — and the stream's `workspace`
// invalidation refreshes all three at once.
// ────────────────────────────────────────────────────────────────

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { queryKeys, type ChangeSummary } from '@generatorai/client-core';

import { useApi } from '../../../api/useApi';

/** The base `ChangesSection` opens on. */
export const DEFAULT_CHANGES_BASE = 'baseline';

export function useChangesSummary(
  workspaceId: string | null,
  options: { enabled?: boolean } = {},
): UseQueryResult<ChangeSummary> {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.changes(workspaceId ?? ''), DEFAULT_CHANGES_BASE],
    queryFn: () => api.workspaces.changes(workspaceId!, { base: DEFAULT_CHANGES_BASE, head: 'working' }),
    enabled: Boolean(workspaceId) && (options.enabled ?? true),
    staleTime: 10_000,
  });
}

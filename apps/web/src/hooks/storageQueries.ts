// ────────────────────────────────────────────────────────────────
// Storage settings hooks (F-settings-15) — the nightly workspace-retention
// sweep. Server-side (persisted next to the database) rather than a client
// preference, because the sweep runs whether or not any browser is open.
// ────────────────────────────────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';
import type { WorkspaceRetentionRunResult } from '../platform/HttpPlatformClient.js';

export const storageKeys = {
  retention: ['workspace-retention'] as const,
};

export function useWorkspaceRetention() {
  const platform = usePlatform();
  return useQuery({
    queryKey: storageKeys.retention,
    queryFn: () => platform.getWorkspaceRetention(),
  });
}

export function useSetWorkspaceRetention() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ enabled, retentionDays }: { enabled: boolean; retentionDays?: number }) =>
      platform.setWorkspaceRetention(enabled, retentionDays),
    onSuccess: (next) => queryClient.setQueryData(storageKeys.retention, next),
  });
}

export function useRunWorkspaceRetention() {
  const platform = usePlatform();
  return useMutation<WorkspaceRetentionRunResult, unknown, number | undefined>({
    mutationFn: (retentionDays) => platform.runWorkspaceRetention(retentionDays),
  });
}

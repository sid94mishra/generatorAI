// MB-25 / MB-26 data: the workspace's path tree (cached long: the path set moves only when files are created or
// deleted) and one file's current contents (`/tree/file`; `contents` is null for binary or over-budget files).
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../services/api/useApi';

export function useWorkspaceTree(workspaceId: string | null, active = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.workspaceTree(workspaceId ?? ''),
    queryFn: () => api.workspaces.tree(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    subscribed: active,
  });
}

export function useFileContent(workspaceId: string, path: string, alias?: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.workspaceFile(workspaceId, path, alias),
    queryFn: () => api.workspaces.treeFile(workspaceId, { path, ...(alias ? { alias } : {}) }),
    enabled: Boolean(workspaceId && path),
    staleTime: 10_000,
  });
}

/** One-off read of a file (Share), through the same cache entry the preview uses. */
export function useWorkspaceFile(workspaceId: string | null) {
  const api = useApi();
  const client = useQueryClient();
  return useCallback(
    (alias: string, path: string) =>
      client.fetchQuery({
        queryKey: queryKeys.workspaceFile(workspaceId ?? '', path, alias),
        queryFn: () => api.workspaces.treeFile(workspaceId!, { path, alias }),
        staleTime: 10_000,
      }),
    [api, client, workspaceId],
  );
}

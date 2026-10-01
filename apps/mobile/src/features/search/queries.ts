import { useQueries } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';
import { useApi } from '../../services/api/useApi';

const STALE_MS = 30_000;

export function useSearchSources() {
  const api = useApi();
  return useQueries({
    queries: [
      { queryKey: queryKeys.chats(), queryFn: () => api.chats.list({ limit: 50 }), staleTime: STALE_MS },
      { queryKey: queryKeys.runs(), queryFn: () => api.runs.list(), staleTime: STALE_MS },
      { queryKey: queryKeys.workflows(), queryFn: () => api.workflows.list(), staleTime: STALE_MS },
      { queryKey: queryKeys.projects(), queryFn: () => api.projects.list(), staleTime: STALE_MS },
      { queryKey: queryKeys.automations(), queryFn: () => api.automations.list(), staleTime: STALE_MS },
      { queryKey: ['agents', 'all'] as const, queryFn: () => api.agents.list(), staleTime: STALE_MS },
    ],
  });
}

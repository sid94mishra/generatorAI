import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../services/api/useApi';

export function useAgents() {
  const api = useApi();
  return useQuery({ queryKey: ['agents', 'all'] as const, queryFn: () => api.agents.list() });
}

export function useSelectableAgents() {
  const api = useApi();
  return useQuery({ queryKey: ['agents', 'selectable'] as const, queryFn: () => api.agents.selectable() });
}

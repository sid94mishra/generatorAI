import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type AdminApi } from '@generatorai/client-core';
import { useApi } from '../../services/api/useApi';
import { useAdminApi } from '../../services/api/useAdminApi';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';
import { isActive, pollIntervalFor } from '../../services/api/runActivity';

export function useWorkflows(options: { enabled?: boolean; staleTime?: number } = {}) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.workflows(), meta: { persist: true }, queryFn: () => api.workflows.list(), ...options });
}

export function useWorkflow(id: string) {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.workflows(), 'detail', id], queryFn: () => api.workflows.get(id) });
}

export function useWorkflowRuns(id?: string, poll = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.runs(id),
    queryFn: () => api.runs.list(id ? { definitionId: id } : undefined),
    refetchInterval: id || !poll ? false : (query) => (query.state.data ?? []).some((run) => isActive(run.status)) ? 10_000 : false,
  });
}

type RemoveResult = Awaited<ReturnType<AdminApi['definitions']['remove']>>;
export function useRemoveWorkflow(id: string, callbacks: MutationCallbacks<RemoveResult>) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks,
    mutationFn: () => admin.definitions.remove(id),
    onSuccess: (...args) => {
      client.removeQueries({ queryKey: [...queryKeys.workflows(), 'detail', id] });
      void client.invalidateQueries({ queryKey: queryKeys.workflows() });
      void client.invalidateQueries({ queryKey: queryKeys.runs() });
      return callbacks.onSuccess?.(...args);
    },
  });
}

export function useRun(id: string, focused: boolean, connected: boolean) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.run(id), queryFn: () => api.runs.get(id), refetchInterval: (query) => focused ? pollIntervalFor(query.state.data?.status, connected) : false });
}
export function useRunPendingDecisions(id: string, enabled: boolean, focused: boolean) {
  const admin = useAdminApi();
  return useQuery({ queryKey: [...queryKeys.run(id), 'pending-decisions'], queryFn: () => admin.runs.pendingDecisions(id), enabled, refetchInterval: focused && enabled ? 5_000 : false });
}
export function useStageTranscript(runId: string, stageId: string, sessionId: string | null, enabled: boolean, focused: boolean, live: boolean, connected: boolean) {
  const admin = useAdminApi();
  return useQuery({ queryKey: queryKeys.stageTranscript(runId, stageId), queryFn: () => admin.sessions.chat(sessionId!, stageId), enabled: Boolean(sessionId) && enabled, refetchInterval: focused && live ? connected ? 15_000 : 5_000 : false });
}

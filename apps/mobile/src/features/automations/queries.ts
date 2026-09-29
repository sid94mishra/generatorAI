import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type AdminApi } from '@generatorai/client-core';
import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';
import { executionPollInterval, type AutomationView, type ExecutionView } from './model';

type AutomationUpdate = Awaited<ReturnType<AdminApi['automations']['enable']>>;
type TriggerResult = Awaited<ReturnType<AdminApi['automations']['trigger']>>;
type ToggleContext = { previous: AutomationView | undefined };

export function useAutomations() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.automations(), queryFn: () => api.automations.list() });
}

export function useAutomation(id: string) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: queryKeys.automation(id),
    queryFn: async () => await admin.automations.get(id) as unknown as AutomationView,
    enabled: id.length > 0,
    refetchInterval: (query) => executionPollInterval(query.state.data?.executions),
  });
}

export function useAutomationExecutions(id: string, enabled: boolean) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: queryKeys.automationExecutions(id),
    queryFn: async () => await admin.automations.executions(id) as unknown as ExecutionView[],
    enabled,
    refetchInterval: (query) => executionPollInterval(query.state.data),
  });
}

export function useRemoveAutomation(id: string, callbacks: MutationCallbacks<void>) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks,
    mutationFn: () => admin.automations.remove(id),
    onSuccess: (...args) => {
      client.removeQueries({ queryKey: queryKeys.automation(id) });
      void client.invalidateQueries({ queryKey: queryKeys.automations() });
      return callbacks.onSuccess?.(...args);
    },
  });
}

export function useToggleAutomation(id: string, callbacks: MutationCallbacks<AutomationUpdate, boolean, ToggleContext>) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (next: boolean) => next ? admin.automations.enable(id) : admin.automations.disable(id),
    onMutate: async (next) => {
      await client.cancelQueries({ queryKey: queryKeys.automation(id), exact: true });
      const previous = client.getQueryData<AutomationView>(queryKeys.automation(id));
      if (previous) client.setQueryData<AutomationView>(queryKeys.automation(id), { ...previous, enabled: next });
      return { previous };
    },
    onError: (...args) => {
      const context = args[2];
      if (context?.previous) client.setQueryData(queryKeys.automation(id), context.previous);
      return callbacks.onError?.(...args);
    },
    onSuccess: (...args) => {
      // Enable/disable responses omit history; retain the detail cache's executions.
      const updated = args[0] as unknown as Partial<AutomationView>;
      client.setQueryData<AutomationView>(queryKeys.automation(id), (previous) => previous ? {
        ...previous, enabled: updated.enabled ?? previous.enabled, nextRunAt: updated.nextRunAt ?? null,
      } : previous);
      return callbacks.onSuccess?.(...args);
    },
    onSettled: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.automations() });
      return callbacks.onSettled?.(...args);
    },
  });
}

export function useTriggerAutomation(id: string, callbacks: MutationCallbacks<TriggerResult, string>) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks,
    mutationFn: (key: string) => admin.automations.trigger(id, undefined, { idempotencyKey: key }),
    onSettled: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.automation(id) });
      return callbacks.onSettled?.(...args);
    },
  });
}

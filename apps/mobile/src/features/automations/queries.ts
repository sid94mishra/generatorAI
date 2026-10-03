// Automations data (M7-04): the list (full rows on the wire), one automation with its executions (polled while one
// runs), an execution with its iteration runs, the workflow names, the 30-day stats (MB-40), and every write —
// enable / disable (optimistic), trigger (with an idempotency key; optional dataset), cancel an execution, rotate the
// webhook token (returned once, NG-02), create / update / delete.
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';
import type { Automation, AutomationExecution, AutomationExecutionWithRuns, CreateAutomationParams, UpdateAutomationParams } from '@generatorai/shared';

import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';
import { executionPollInterval, isExecutionActive, makeIdempotencyKey } from './model';

export function useAutomations() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.automations(), meta: { persist: true }, queryFn: async () => (await api.automations.list()) as unknown as Automation[] });
}

export function useAutomation(id: string) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: queryKeys.automation(id),
    queryFn: async () => (await admin.automations.get(encodeURIComponent(id))) as unknown as Automation & { executions?: AutomationExecution[] },
    enabled: id.length > 0,
    refetchInterval: (query) => executionPollInterval(query.state.data?.executions as never),
  });
}

export function useExecution(id: string, executionId: string) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: [...queryKeys.automationExecutions(id), executionId],
    queryFn: (): Promise<AutomationExecutionWithRuns> => admin.automations.execution(encodeURIComponent(id), encodeURIComponent(executionId)),
    enabled: Boolean(id && executionId),
    refetchInterval: (query) => (isExecutionActive(query.state.data?.status) ? 3_000 : false),
  });
}

/** id → name / stage count for the workflow rows (one list call, shared with the Workflows screen's cache). */
export function useWorkflowNames(projectId?: string | null) {
  const api = useApi();
  const workflows = useQuery({ queryKey: [...queryKeys.workflows(), projectId ?? 'all'], meta: { persist: true }, queryFn: () => api.workflows.list(projectId ?? undefined), staleTime: 60_000 });
  const byId = useMemo(() => new Map((workflows.data ?? []).map((w) => [w.id, w])), [workflows.data]);
  return { workflows, byId };
}

export function useProjectsList() {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.projects(), 'summary'], meta: { persist: true }, queryFn: () => api.projects.list({ includeSummary: true }), staleTime: 60_000 });
}

export function useAutomationWrites() {
  const admin = useAdminApi();
  const client = useQueryClient();
  const refresh = (id?: string) => {
    void client.invalidateQueries({ queryKey: queryKeys.automations() });
    if (id) void client.invalidateQueries({ queryKey: queryKeys.automation(id) });
  };
  const enc = encodeURIComponent;
  return {
    setEnabled: async (id: string, enabled: boolean) => {
      // Optimistic in both caches; the server's answer (or a refetch on error) settles it.
      client.setQueryData<Automation[]>(queryKeys.automations(), (list) => list?.map((a) => (a.id === id ? { ...a, enabled } : a)));
      client.setQueryData<Automation>(queryKeys.automation(id), (a) => (a ? { ...a, enabled } : a));
      try {
        return await (enabled ? admin.automations.enable(enc(id)) : admin.automations.disable(enc(id)));
      } finally {
        refresh(id);
      }
    },
    trigger: (id: string, dataset?: unknown) => admin.automations.trigger(enc(id), dataset ? { dataset } : undefined, { idempotencyKey: makeIdempotencyKey(id) }).finally(() => refresh(id)),
    cancelExecution: (id: string, executionId: string) =>
      admin.automations.cancelExecution(enc(id), enc(executionId)).finally(() => {
        refresh(id);
        void client.invalidateQueries({ queryKey: queryKeys.automationExecutions(id) });
      }),
    /** `{ token, signingSecret? }` — shown once (NG-02). */
    rotate: async (id: string) => (await admin.automations.rotateWebhookToken(enc(id))) as { token: string; signingSecret?: string },
    remove: (id: string) => admin.automations.remove(enc(id)).finally(() => refresh()),
    update: (id: string, body: UpdateAutomationParams) => admin.automations.update(enc(id), body).finally(() => refresh(id)),
  };
}

/** Create returns the automation; a webhook one also carries `webhookToken` + `webhookSigningSecret` once. */
export function useCreateAutomation() {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateAutomationParams) => (await admin.automations.create(body)) as Automation & { webhookSigningSecret?: string },
    onSettled: () => void client.invalidateQueries({ queryKey: queryKeys.automations() }),
  });
}

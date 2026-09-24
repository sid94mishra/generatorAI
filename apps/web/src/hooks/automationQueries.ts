// ────────────────────────────────────────────────────────────────
// TanStack Query hooks — Automations, Executions
// ────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';
import type { HttpPlatformClient } from '../platform/HttpPlatformClient.js';
import type { CreateAutomationParams, UpdateAutomationParams, Automation, AutomationExecution } from '@generatorai/shared';

export const automationKeys = {
  all: ['automations'] as const,
  detail: (id: string) => ['automation', id] as const,
  executions: (id: string) => ['automation-executions', id] as const,
  execution: (automationId: string, execId: string) => ['automation-execution', automationId, execId] as const,
};

/** List all automations */
export function useAutomations() {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: automationKeys.all,
    queryFn: () => platform.listAutomations(),
    staleTime: 15_000,
  });
}

/** Get a single automation with executions */
export function useAutomation(id: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: automationKeys.detail(id ?? ''),
    queryFn: () => platform.getAutomation(id!),
    enabled: !!id,
    staleTime: 5_000,
    refetchInterval: (query) => {
      // Poll faster when there are running executions
      const data = query.state.data as { executions?: { status: string }[] } | undefined;
      const hasRunning = data?.executions?.some((e: { status: string }) => e.status === 'running' || e.status === 'pending');
      return hasRunning ? 3_000 : 30_000;
    },
  });
}

/** Get executions for an automation */
export function useAutomationExecutions(automationId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: automationKeys.executions(automationId ?? ''),
    queryFn: () => platform.getAutomationExecutions(automationId!),
    enabled: !!automationId,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const data = query.state.data as { status: string }[] | undefined;
      const hasRunning = Array.isArray(data) && data.some((e: { status: string }) => e.status === 'running' || e.status === 'pending');
      return hasRunning ? 3_000 : 30_000;
    },
  });
}

/** Get a single execution with runs */
export function useAutomationExecution(automationId: string | undefined, executionId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: automationKeys.execution(automationId ?? '', executionId ?? ''),
    queryFn: () => platform.getAutomationExecution(automationId!, executionId!),
    enabled: !!automationId && !!executionId,
    staleTime: 3_000,
    refetchInterval: (query) => {
      const data = query.state.data as { status?: string } | undefined;
      const isRunning = data?.status === 'running' || data?.status === 'pending';
      return isRunning ? 3_000 : 15_000;
    },
  });
}

/** One automation execution enriched with its parent automation's name. */
export interface LiveAutomationExecution extends AutomationExecution {
  automationName: string;
}

/**
 * Dashboard helper — fetch the latest executions for every automation that
 * has run (or is enabled) and surface each one's *current* execution status.
 * Returns the newest execution per automation so the mission-control list can
 * show "running now" and "last run failed" without an N-deep history.
 *
 * Uses `useQueries` (one query per automation) with fast polling while any
 * execution is running. Typical deployments have a handful of automations,
 * so the request fan-out stays small.
 */
export function useLatestAutomationExecutions(automations: Automation[]): {
  byStatus: (statuses: string[]) => LiveAutomationExecution[];
  isLoading: boolean;
} {
  const platform = usePlatform() as HttpPlatformClient;
  const targets = automations.filter((a) => a.enabled || a.lastRunAt);

  const results = useQueries({
    queries: targets.map((a) => ({
      queryKey: automationKeys.executions(a.id),
      queryFn: () => platform.getAutomationExecutions(a.id),
      staleTime: 4_000,
      refetchInterval: (query: { state: { data?: unknown } }) => {
        const data = query.state.data as { status: string }[] | undefined;
        const hasRunning = Array.isArray(data) && data.some((e) => e.status === 'running' || e.status === 'pending');
        return hasRunning ? 3_000 : 20_000;
      },
    })),
  });

  // Newest execution per automation (the current state of that automation).
  const latest: LiveAutomationExecution[] = [];
  results.forEach((res, i) => {
    const execs = res.data;
    const automation = targets[i];
    if (!automation || !Array.isArray(execs) || execs.length === 0) return;
    const newest = [...execs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
    if (newest) latest.push({ ...newest, automationName: automation.name });
  });

  return {
    byStatus: (statuses) => latest.filter((e) => statuses.includes(e.status)),
    isLoading: results.some((r) => r.isLoading),
  };
}

/** Create a new automation */
export function useCreateAutomation() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateAutomationParams) => platform.createAutomation(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

/** Delete an automation */
export function useDeleteAutomation() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platform.deleteAutomation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

/** Enable an automation */
export function useEnableAutomation() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platform.enableAutomation(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
      queryClient.invalidateQueries({ queryKey: automationKeys.detail(id) });
    },
  });
}

/** Disable an automation */
export function useDisableAutomation() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platform.disableAutomation(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
      queryClient.invalidateQueries({ queryKey: automationKeys.detail(id) });
    },
  });
}

/** Trigger an automation manually with optional dataset. */
export function useTriggerAutomation() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      id: string;
      body?: { dataset?: { format: 'json_array' | 'csv' | 'jsonl'; data: string }; saveAsDefault?: boolean };
      idempotencyKey?: string;
    }) => platform.triggerAutomation(
      args.id,
      args.body,
      args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
    ),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: automationKeys.detail(args.id) });
      queryClient.invalidateQueries({ queryKey: automationKeys.executions(args.id) });
    },
  });
}

/** Track C — preview iteration expansion without triggering. */
export function usePreviewIterations() {
  const platform = usePlatform() as HttpPlatformClient;
  return useMutation({
    mutationFn: (body: { dataSchema: unknown; iterationMode: unknown; dataset: unknown }) =>
      platform.previewAutomationIterations(body),
  });
}

/** Cancel an automation execution */
export function useCancelAutomationExecution() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { automationId: string; executionId: string }) =>
      platform.cancelAutomationExecution(args.automationId, args.executionId),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: automationKeys.detail(args.automationId) });
      queryClient.invalidateQueries({ queryKey: automationKeys.executions(args.automationId) });
      queryClient.invalidateQueries({ queryKey: automationKeys.execution(args.automationId, args.executionId) });
    },
  });
}

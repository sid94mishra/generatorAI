// Workflows data (M8): the definition list (full summary rows on the wire), one definition, its versions, its runs,
// the 30-day stats per definition (NG-04) and for one definition, the templates, the projects / codebases / agents a
// new draft can pick, the automations linked to a workflow, and every definition write (create from a graph,
// import, duplicate, export, delete). The run hooks below serve the run screens.
import { useCallback, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type AdminApi } from '@generatorai/client-core';
import type { StatsByDefinitionRow } from '@generatorai/shared';
import type { InvocationRequest, WorkflowDefinitionRecord, WorkflowDefinitionSummary, WorkflowGraphInput, WorkflowTemplate } from '@generatorai/workflow-spec';

import { runHref } from '../../blocks/shell/hrefs';
import { useStatsSummary } from '../../blocks/StatsCards';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';
import { isActive, pollIntervalFor } from '../../services/api/runActivity';
import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';

export const workflowKey = (id: string) => [...queryKeys.workflows(), 'detail', id] as const;
const versionsKey = (id: string) => [...workflowKey(id), 'versions'] as const;
const TEMPLATES_KEY = [...queryKeys.workflows(), 'templates'] as const;

/** Every definition with the fields the list draws (the wire rows are `WorkflowDefinitionSummary`). */
export function useWorkflows(options: { enabled?: boolean; staleTime?: number } = {}) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.workflows(),
    meta: { persist: true },
    queryFn: async () => (await api.workflows.list()) as unknown as WorkflowDefinitionSummary[],
    ...options,
  });
}

/** The 30-day window, fixed when a screen opens (a refetch keeps its cache key). */
export function useThirtyDays(): { from: string; to: string } {
  const [range] = useState(() => ({ from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to: new Date().toISOString() }));
  return range;
}

/** Last run + success per definition (NG-04) and the totals line. */
export function useDefinitionStats() {
  const range = useThirtyDays();
  const summary = useStatsSummary({ ...range, groupBy: 'definition' });
  const byId = useMemo(() => new Map<string, StatsByDefinitionRow>((summary.data?.byDefinition ?? []).map((r) => [r.definitionId, r])), [summary.data]);
  return { summary, byId };
}

export function useWorkflowStats(id: string) {
  const range = useThirtyDays();
  return useStatsSummary({ ...range, definitionId: id }, { enabled: Boolean(id) });
}

export function useWorkflow(id: string) {
  const api = useApi();
  return useQuery({ queryKey: workflowKey(id), queryFn: () => api.workflows.get(id), enabled: Boolean(id) });
}

export function useDefinitionVersions(id: string) {
  const admin = useAdminApi();
  return useQuery({ queryKey: versionsKey(id), queryFn: () => admin.definitions.versions(id), enabled: Boolean(id), staleTime: 30_000 });
}

/** A workflow's runs, newest first (the server answers oldest first; `limit` keeps the newest). */
export function useWorkflowRuns(id?: string, opts: { limit?: number; poll?: boolean } = {}) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.runs(id), opts.limit ?? 'all'],
    queryFn: async () => [...(await api.runs.list({ ...(id ? { definitionId: id } : {}), ...(opts.limit ? { limit: opts.limit } : {}) }))].reverse(),
    refetchInterval: opts.poll === false ? false : (query) => ((query.state.data ?? []).some((run) => isActive(run.status)) ? 10_000 : false),
  });
}

export function useTemplates(enabled = true) {
  const admin = useAdminApi();
  return useQuery({ queryKey: TEMPLATES_KEY, queryFn: () => admin.templates.list() as Promise<WorkflowTemplate[]>, staleTime: 5 * 60_000, enabled });
}

export function useProjectsList() {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.projects(), 'summary'], meta: { persist: true }, queryFn: () => api.projects.list({ includeSummary: true }), staleTime: 60_000 });
}

export function useProjectCodebases(projectId: string | null) {
  const admin = useAdminApi();
  return useQuery({ queryKey: [...queryKeys.projects(), projectId ?? '', 'codebases'], queryFn: () => admin.projects.codebases.list(projectId!), enabled: Boolean(projectId), staleTime: 60_000 });
}

export function useSelectableAgents(projectId?: string | null) {
  const api = useApi();
  return useQuery({ queryKey: ['agents', 'selectable', projectId ?? ''] as const, meta: { persist: true }, queryFn: () => api.agents.selectable(projectId ?? undefined), staleTime: 60_000 });
}

/** Automations that run this workflow (MWorkflowDetailMore "Automation"). */
export function useLinkedAutomations(workflowId: string) {
  const api = useApi();
  const automations = useQuery({ queryKey: queryKeys.automations(), meta: { persist: true }, queryFn: () => api.automations.list(), staleTime: 60_000 });
  const linked = useMemo(() => (automations.data ?? []).filter((a) => a.workflowIds.includes(workflowId)), [automations.data, workflowId]);
  return { automations, linked };
}

/** Definition writes; each refreshes the list and the definition. */
export function useWorkflowWrites() {
  const admin = useAdminApi();
  const client = useQueryClient();
  const refresh = (id?: string): void => {
    void client.invalidateQueries({ queryKey: queryKeys.workflows() });
    if (id) void client.invalidateQueries({ queryKey: workflowKey(id) });
  };
  return {
    create: (graph: WorkflowGraphInput): Promise<WorkflowDefinitionRecord> => admin.definitions.create(graph).finally(() => refresh()),
    importDocument: (graph: unknown): Promise<WorkflowDefinitionRecord> => admin.definitions.import(graph).finally(() => refresh()),
    exportText: (id: string): Promise<string> => admin.definitions.export(id),
    remove: (id: string) =>
      admin.definitions.remove(id).finally(() => {
        client.removeQueries({ queryKey: workflowKey(id) });
        refresh();
        void client.invalidateQueries({ queryKey: queryKeys.runs() });
      }),
  };
}

/** Start a run (one invocation, P04): a new run of the published version, or a test run of the draft. */
export function useInvokeWorkflow(workflowId: string) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: InvocationRequest; idempotencyKey: string }) => admin.workflows.invoke(body, { idempotencyKey }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.runs(workflowId) });
      void client.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

// ── Runs (the run screens) ────────────────────────────────────────

type RemoveResult = Awaited<ReturnType<AdminApi['definitions']['remove']>>;
export function useRemoveWorkflow(id: string, callbacks: MutationCallbacks<RemoveResult>) {
  const writes = useWorkflowWrites();
  return useMutation({ ...callbacks, mutationFn: () => writes.remove(id) });
}

export function useRun(id: string, focused: boolean, connected: boolean) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.run(id), queryFn: () => api.runs.get(id), refetchInterval: (query) => (focused ? pollIntervalFor(query.state.data?.status, connected) : false) });
}
export function useRunPendingDecisions(id: string, enabled: boolean, focused: boolean) {
  const admin = useAdminApi();
  return useQuery({ queryKey: [...queryKeys.run(id), 'pending-decisions'], queryFn: () => admin.runs.pendingDecisions(id), enabled, refetchInterval: focused && enabled ? 5_000 : false });
}
export function useStageTranscript(runId: string, stageId: string, sessionId: string | null, enabled: boolean, focused: boolean, live: boolean, connected: boolean) {
  const admin = useAdminApi();
  return useQuery({ queryKey: queryKeys.stageTranscript(runId, stageId), queryFn: () => admin.sessions.chat(sessionId!, stageId), enabled: Boolean(sessionId) && enabled, refetchInterval: focused && live ? (connected ? 15_000 : 5_000) : false });
}

// Opening a run (MD-80): a run lives at /workflows/<workflowId>/runs/<runId>. Callers that only hold the run id
// resolve its workflow through the run screen's own query (`queryKeys.run`), which warms that screen's cache.
export type OpenRun = (runId: string, workflowId?: string | null, mode?: 'push' | 'replace') => Promise<void>;

export function useOpenRun(): OpenRun {
  const api = useApi();
  const client = useQueryClient();
  return useCallback<OpenRun>(
    async (runId, workflowId, mode = 'push') => {
      const wid = workflowId ?? (await client.fetchQuery({ queryKey: queryKeys.run(runId), queryFn: () => api.runs.get(runId) })).workflowDefinitionId;
      const href = runHref(wid, runId) as never;
      if (mode === 'replace') router.replace(href);
      else router.push(href);
    },
    [api, client],
  );
}

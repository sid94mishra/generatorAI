// Workflows data (M8): the definition list (full summary rows on the wire), one definition, its versions, its runs,
// the 30-day stats per definition (NG-04) and for one definition, the templates, the projects / codebases / agents a
// new draft can pick, the automations linked to a workflow, and every definition write (create from a graph,
// import, duplicate, export, delete). The run hooks below serve the run screens.
import { useCallback, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type AdminApi, type AgentMode } from '@generatorai/client-core';
import type { ApprovalProof, StatsByDefinitionRow } from '@generatorai/shared';
import type { RunCommand, InvocationRequest, WorkflowDefinitionRecord, WorkflowDefinitionSummary, WorkflowGraphInput, WorkflowTemplate } from '@generatorai/workflow-spec';

import { runHref } from '../../blocks/shell/hrefs';
import { useStatsSummary } from '../../blocks/StatsCards';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';
import { isActive, pollIntervalFor } from '../../services/api/runActivity';
import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';
import { sendStageMessage } from '../../services/api/sendStageMessage';
import type { ChatUpload } from '../../services/api/sendChatPrompt';
import { useAuth } from '../../services/auth/AuthProvider';

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

/** What a run of this request would do (`POST /workflow-invocations/plan`); nothing is written. */
export function usePlanInvocation() {
  const admin = useAdminApi();
  return useMutation({ mutationFn: (body: InvocationRequest) => admin.workflows.plan(body) });
}

/** A codebase's branches (the run sheet's base ref). */
export function useCodebaseBranches(projectId: string | null, codebaseId: string | null) {
  const admin = useAdminApi();
  return useQuery({ queryKey: [...queryKeys.projects(), projectId ?? '', 'codebases', codebaseId ?? '', 'branches'], queryFn: () => admin.projects.codebases.branches(projectId!, codebaseId!), enabled: Boolean(projectId && codebaseId), staleTime: 60_000 });
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

/** The run's pinned definition version (stage specs for the rows, edges for the graph, review rounds). */
export function useRunGraph(workflowId: string, versionId: string | null | undefined) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: [...workflowKey(workflowId), 'version', versionId ?? ''],
    queryFn: () => admin.definitions.version(workflowId, versionId!),
    enabled: Boolean(workflowId && versionId),
    staleTime: Infinity,
  });
}

const refreshRun = (client: ReturnType<typeof useQueryClient>, runId: string) =>
  Promise.all([client.invalidateQueries({ queryKey: queryKeys.run(runId) }), client.invalidateQueries({ queryKey: queryKeys.runs() })]);

/**
 * Run and stage commands (`POST /workflow-runs/:id/commands`, P03): pause (drain / interrupt), resume, cancel; a
 * stage's pause, resume, retry (resume / restart), skip (as completed), cancel. A finished run is never mutated:
 * "Retry failed" and "Re-run from here" fork a NEW run (`POST /workflow-invocations`, target fork). The run refetches
 * on settle — the server decides where it landed (a 409 means another device got there first).
 */
export function useRunCommands(runId: string) {
  const admin = useAdminApi();
  const client = useQueryClient();
  const command = useMutation({
    mutationFn: (body: RunCommand) => admin.runs.command(runId, body),
    onSettled: () => refreshRun(client, runId),
  });
  const fork = useMutation({
    mutationFn: ({ rerunFrom, idempotencyKey }: { rerunFrom?: string[]; idempotencyKey: string }) =>
      admin.workflows.invoke({ target: { kind: 'fork', sourceRunId: runId, definition: 'pinned', workspace: 'fresh', ...(rerunFrom ? { rerunFrom } : {}) }, variables: {}, client: 'mobile' }, { idempotencyKey }),
    onSettled: () => refreshRun(client, runId),
  });
  const remove = useMutation({
    mutationFn: () => admin.runs.remove(runId),
    onSuccess: () => {
      client.removeQueries({ queryKey: queryKeys.run(runId) });
      void client.invalidateQueries({ queryKey: queryKeys.runs() });
    },
  });
  return { command, fork, remove };
}

/** The run's live permission mode (`GET / PATCH /workflow-runs/:id/permission-mode`). */
export function useRunPermissionMode(runId: string, enabled: boolean) {
  const admin = useAdminApi();
  const client = useQueryClient();
  const key = [...queryKeys.run(runId), 'permission-mode'] as const;
  const mode = useQuery({ queryKey: key, queryFn: async () => (await admin.runs.permissionMode.get(runId)).mode, enabled, staleTime: 30_000 });
  const setMode = useMutation({
    mutationFn: async (next: string) => (await admin.runs.permissionMode.set(runId, next)).mode,
    onMutate: async (next) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<string>(key);
      client.setQueryData(key, next);
      return { previous };
    },
    onSuccess: (confirmed) => client.setQueryData(key, confirmed),
    onError: (_e, _next, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
    },
  });
  return { mode, setMode };
}

/** A stage's gate answered with the `approve` command (signed from a phone, MG-05); the run refetches. */
export function useApproveStage(runId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.runs.approveStage>[1]) => api.runs.approveStage(runId, input),
    onSettled: () => refreshRun(client, runId),
  });
}

/**
 * A stage is a compact chat (P03b): send a message (queued between turns, an amendment of a completed stage, a
 * retry of a paused one; 409 STAGE_BUSY mid-turn), stop the turn in flight, answer an in-turn gate in the chat's
 * shapes (a risky permission signed, MG-05). Every mutation refetches the run and the transcript.
 */
export function useStageConversation(runId: string, stageRunId: string) {
  const api = useApi();
  const { fetch } = useAuth();
  const client = useQueryClient();
  const refresh = () => Promise.all([refreshRun(client, runId), client.invalidateQueries({ queryKey: queryKeys.stageTranscript(runId, stageRunId) })]);
  const send = useMutation({
    mutationFn: (input: { message: string; mode?: AgentMode | undefined; files: ChatUpload[] }) =>
      sendStageMessage(fetch, runId, stageRunId, { message: input.message, ...(input.mode ? { mode: input.mode } : {}) }, input.files),
    onSettled: refresh,
  });
  const stop = useMutation({ mutationFn: (options: { force?: boolean }) => api.runs.cancelStageTurn(runId, stageRunId, options), onSettled: refresh });
  const permission = useMutation({
    mutationFn: (input: { interactionId: string; behavior: 'allow' | 'deny'; message?: string; approvalProof?: ApprovalProof }) =>
      api.runs.stagePermission(runId, stageRunId, input.interactionId, { behavior: input.behavior, ...(input.message ? { message: input.message } : {}), ...(input.approvalProof ? { approvalProof: input.approvalProof } : {}) }),
    onSettled: refresh,
  });
  const answer = useMutation({
    mutationFn: (input: { interactionId: string; answers: Record<string, string[]>; freeformResponse?: string }) =>
      api.runs.stageAnswer(runId, stageRunId, input.interactionId, { answers: input.answers, ...(input.freeformResponse ? { freeformResponse: input.freeformResponse } : {}) }),
    onSettled: refresh,
  });
  const plan = useMutation({
    mutationFn: (input: { interactionId: string; approved: boolean; action?: 'exit_only' | 'implement_interactive' | 'implement_autopilot'; feedback?: string }) =>
      api.runs.stagePlan(runId, stageRunId, input.interactionId, { approved: input.approved, ...(input.action ? { action: input.action } : {}), ...(input.feedback ? { feedback: input.feedback } : {}) }),
    onSettled: refresh,
  });
  return { send, stop, permission, answer, plan };
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

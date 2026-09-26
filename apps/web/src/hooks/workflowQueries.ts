// ────────────────────────────────────────────────────────────────
// TanStack Query hooks — Workflow Definitions and Runs
// All mutations invalidate relevant query caches automatically
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';
import { openMultiplexedStream } from '../platform/muxStream.js';
import type { HttpPlatformClient } from '../platform/HttpPlatformClient.js';
import type { InvocationFiles, WorkflowRunListFilter, WorkflowRunPermissionMode } from '@generatorai/shared';
import type { InvocationRequest, RunCommand, WorkflowDefinitionRecord, WorkflowGraphInput } from '@generatorai/workflow-spec';
import { mergeWorkflowRunCards, type WorkflowRunCardView } from '@generatorai/client-core';

// ── Query Keys ──
export const workflowKeys = {
  definitions: ['workflow-definitions'] as const,
  definition: (id: string) => ['workflow-definition', id] as const,
  definitionVersion: (id: string, versionId: string) => ['workflow-definition', id, 'version', versionId] as const,
  runs: ['workflow-runs'] as const,
  runsByDefinition: (defId: string) => ['workflow-runs', 'by-definition', defId] as const,
  runSearch: (filter: WorkflowRunListFilter) => ['workflow-runs', 'search', filter] as const,
  /** A definition's versions (the builder's history). */
  definitionVersions: (id: string) => ['workflow-definition', id, 'versions'] as const,
  /** One stage's executions across the definition's runs. */
  stageHistory: (definitionId: string, stageKey: string, limit: number) => ['stage-history', definitionId, stageKey, limit] as const,
  run: (id: string) => ['workflow-run', id] as const,
  runWorkspace: (runId: string) => ['run-workspace', runId] as const,
  /** Every loop's finished iterations of a run (the prefix the loop events invalidate). */
  loopIterationsOfRun: (runId: string) => ['loop-iterations', runId] as const,
  loopIterations: (runId: string, instanceId: string) => ['loop-iterations', runId, instanceId] as const,
  /** The decisions a run waits on, its sub-workflow children's mirrored (P05). */
  pendingDecisions: (runId: string) => ['pending-decisions', runId] as const,
  /** The runs a chat started (P06 WP-6.2), patched live by `chat.workflow_run.*`. */
  chatRuns: (chatId: string) => ['chat-workflow-runs', chatId] as const,
};

// ════════════════════════════════════════════════════════════════
// Definition Queries & Mutations
// ════════════════════════════════════════════════════════════════

/** List workflow definitions (summaries) */
export function useWorkflowDefinitions() {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.definitions,
    queryFn: () => platform.listDefinitions(),
    staleTime: 30_000,
  });
}

/** Get a single workflow definition record (its working graph plus bookkeeping) */
export function useWorkflowDefinition(id: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.definition(id ?? ''),
    queryFn: () => platform.getDefinition(id!),
    enabled: !!id,
  });
}

/** The immutable version a run pinned: the graph the run actually executes. */
export function useWorkflowDefinitionVersion(id: string | undefined, versionId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: workflowKeys.definitionVersion(id ?? '', versionId ?? ''),
    queryFn: () => platform.getDefinitionVersion(id!, versionId!),
    enabled: !!id && !!versionId,
    // Versions never change.
    staleTime: Infinity,
  });
}

/**
 * A mutation that returns a definition record: the detail cache is set from
 * the response (so the builder never refetches its own save) and the list is
 * invalidated.
 */
function useRecordMutation<A>(fn: (args: A) => Promise<WorkflowDefinitionRecord>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (record) => {
      queryClient.setQueryData(workflowKeys.definition(record.id), record);
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions });
    },
  });
}

/** Create a draft definition from a graph */
export function useCreateWorkflowDefinition() {
  const platform = usePlatform();
  return useRecordMutation((graph: WorkflowGraphInput) => platform.createDefinition(graph));
}

/** Replace a definition graph (optimistic concurrency on `expectedRevision`) */
export function useSaveDefinitionGraph() {
  const platform = usePlatform();
  return useRecordMutation((args: { id: string; graph: WorkflowGraphInput; expectedRevision: number }) =>
    platform.saveDefinitionGraph(args.id, args.graph, args.expectedRevision),
  );
}

/** Publish the working graph as the version runs use */
export function usePublishDefinition() {
  const platform = usePlatform() as HttpPlatformClient;
  return useRecordMutation((id: string) => platform.publishDefinition(id));
}

/** Import a canonical workflow document as a new draft */
export function useImportDefinition() {
  const platform = usePlatform() as HttpPlatformClient;
  return useRecordMutation((document: unknown) => platform.importDefinition(document));
}

/** Create a workflow definition from a template (`POST /workflow-definitions/import`) */
export function useCreateFromTemplate() {
  const platform = usePlatform() as HttpPlatformClient;
  return useRecordMutation((args: { templateId: string; name?: string }) =>
    platform.importTemplate(args.templateId, args.name),
  );
}

/**
 * Delete a workflow definition. The server archives it instead when runs
 * pinned it; the outcome says which happened.
 */
export function useDeleteWorkflowDefinition() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platform.deleteDefinition(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions });
    },
  });
}

/**
 * Bulk-delete multiple workflow definitions in parallel. Resolves with how
 * many were deleted and how many archived (they had runs).
 */
export function useBulkDeleteWorkflowDefinitions() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => platform.deleteDefinition(id)));
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        throw new Error(`Failed to delete ${failed.length} of ${ids.length} workflows`);
      }
      const archived = results.filter((r) => r.status === 'fulfilled' && 'archived' in r.value).length;
      return { deleted: ids.length - archived, archived };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions });
    },
    onError: () => {
      // Still refresh the list — some deletions may have succeeded
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// Workflow Run Queries & Mutations
// ════════════════════════════════════════════════════════════════

/** Search workflow runs (every filter narrows; none lists them all). */
export function useWorkflowRuns(filter?: WorkflowRunListFilter, opts: { enabled?: boolean } = {}) {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.runSearch(filter ?? {}),
    queryFn: () => platform.listRuns(filter),
    enabled: opts.enabled ?? true,
    // A changed filter keeps the previous rows on screen until the new ones arrive.
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
}

/** One stage's newest executions across a definition's runs; fetched only while `enabled`. */
export function useStageHistory(definitionId: string | undefined, stageKey: string | undefined, opts: { enabled?: boolean; limit?: number } = {}) {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.stageHistory(definitionId ?? '', stageKey ?? '', opts.limit ?? 20),
    queryFn: () => platform.getStageHistory(definitionId!, stageKey!, opts.limit ?? 20),
    enabled: !!definitionId && !!stageKey && (opts.enabled ?? true),
    staleTime: 10_000,
  });
}

/** A definition's published and test versions, newest first; fetched only while `enabled`. */
export function useDefinitionVersions(id: string | undefined, opts: { enabled?: boolean } = {}) {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.definitionVersions(id ?? ''),
    queryFn: async () => (await platform.listDefinitionVersions(id!)).sort((a, b) => b.version - a.version),
    enabled: !!id && (opts.enabled ?? true),
    staleTime: 10_000,
  });
}

/** Get a single workflow run with stage runs */
export function useWorkflowRun(id: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.run(id ?? ''),
    queryFn: () => platform.getRun(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const run = query.state.data;
      if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) {
        return false;
      }
      return 5_000;
    },
  });
}

/**
 * Start a run — THE one way (P04): a definition (a draft as a test run), a
 * script, or a fork of an earlier run. Resolves with the invocation result;
 * callers navigate to `result.runId`. `inline` is for the run dialog, which
 * renders the error envelope's message and issues itself; everywhere else a
 * refusal is toasted.
 */
export function useInvokeWorkflow(opts: { inline?: boolean; errorTitle?: string } = {}) {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (p: { request: InvocationRequest; idempotencyKey?: string; files?: InvocationFiles }) =>
      platform.invokeWorkflow(p.request, {
        ...(p.idempotencyKey ? { idempotencyKey: p.idempotencyKey } : {}),
        ...(p.files ? { files: p.files } : {}),
      }),
    meta: opts.inline ? { silentError: true } : { errorTitle: opts.errorTitle ?? 'Run not started' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
    },
  });
}

/** What a start would do (the run dialog's plan preview); writes nothing. */
export function usePlanWorkflowInvocation() {
  const platform = usePlatform();
  return useMutation({
    mutationFn: (request: InvocationRequest) => platform.planWorkflowInvocation(request),
    meta: { silentError: true },
  });
}

/**
 * The runs a chat started, as cards (P06 WP-6.2). The chat stream folds its
 * `chat.workflow_run.*` events into this cache and refetches it; the finalize
 * event's summary and PR survive the refetch (the REST card does not repeat
 * them). Polls only as a fallback while a run is live.
 */
export function useChatWorkflowRuns(chatId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: workflowKeys.chatRuns(chatId ?? ''),
    queryFn: async (): Promise<{ runs: WorkflowRunCardView[] }> => {
      const { runs } = await platform.getChatWorkflowRuns(chatId!);
      const prior = queryClient.getQueryData<{ runs: WorkflowRunCardView[] }>(workflowKeys.chatRuns(chatId!));
      return { runs: mergeWorkflowRunCards(runs, prior?.runs) };
    },
    enabled: !!chatId,
    staleTime: 10_000,
    refetchInterval: (query) =>
      query.state.data?.runs.some((r) => !['completed', 'failed', 'cancelled'].includes(r.status)) ? 15_000 : false,
  });
}

/**
 * Send a run command (pause, resume, cancel, retry, skip, fail, approve) to
 * the run or one of its instances. A refused command rejects with the
 * server's 409/400/404; the run refetches either way.
 */
export function useRunCommand() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ runId, command }: { runId: string; command: RunCommand }) =>
      platform.runCommand(runId, command),
    // D-13: a refused command is toasted by the global handler with the server's reason.
    meta: { errorTitle: 'Run command not applied' },
    onSettled: (_data, _err, { runId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.loopIterationsOfRun(runId) });
      // A decision of a sub-workflow child is mirrored in its parent's list too.
      queryClient.invalidateQueries({ queryKey: ['pending-decisions'] });
    },
  });
}

// ── Loops (P05) ──────────────────────────────────────────────────

/**
 * A loop instance's finished iterations (`loop_iterations`): carry, exit
 * values, streaks, signals, score and checkpoint per iteration. Refetched
 * by `useLoopEventRefetch` when the run's loop events arrive.
 */
export function useLoopIterations(runId: string | undefined, instanceId: string | undefined, opts: { enabled?: boolean } = {}) {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.loopIterations(runId ?? '', instanceId ?? ''),
    queryFn: () => platform.listLoopIterations(runId!, instanceId!),
    enabled: !!runId && !!instanceId && (opts.enabled ?? true),
  });
}

/** The run-stream events of the P05 containers and waits: loops, maps, sub-workflows, waits arming. */
const LOOP_EVENT_PREFIXES = ['loop.', 'map.', 'subworkflow.', 'stage_run.waiting', 'stage_run.awaiting_input', 'stage_run.completed'] as const;

/**
 * Keep a run's containers live: on every `loop.*` (iteration started or
 * completed, exit, parked, command applied, wrap-up, errors), `map.*`
 * (items started and completed) and `subworkflow.*` event, and when a wait
 * arms or a decision appears or resolves, the run refetches (the
 * instances' loop and map state), and so do the loops' iteration rows and
 * the run's pending decisions.
 */
export function useLoopEventRefetch(runId: string | undefined, enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!runId || !enabled) return;
    const handle = openMultiplexedStream(
      'run',
      runId,
      {
        onMessage: () => {
          void queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) });
          void queryClient.invalidateQueries({ queryKey: workflowKeys.loopIterationsOfRun(runId) });
          void queryClient.invalidateQueries({ queryKey: workflowKeys.pendingDecisions(runId) });
        },
      },
      LOOP_EVENT_PREFIXES,
    );
    return () => { handle.close(); };
  }, [runId, enabled, queryClient]);
}

/**
 * The decisions a run waits on (P05): its own and, mirrored, those of its
 * running sub-workflow children. A child's decisions do not reach the
 * parent's stream, so the list also polls while the run is live.
 */
export function usePendingDecisions(runId: string | undefined, opts: { live?: boolean } = {}) {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.pendingDecisions(runId ?? ''),
    queryFn: () => platform.listPendingDecisions(runId!),
    enabled: !!runId,
    refetchInterval: opts.live ? 4_000 : false,
  });
}

// ── A stage is a compact chat (P03b) ─────────────────────────────

/**
 * Send an operator message to a stage instance: queued between turns, an
 * amendment of a completed stage, a retry of a paused one. A refusal (409
 * STAGE_BUSY mid-turn, INTERACTION_PENDING, …) is toasted as "Message not
 * sent", like a chat's.
 */
export function useSendStageMessage() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (p: { runId: string; instanceId: string; prompt: string; files?: File[]; mode?: 'auto' | 'plan' }) =>
      platform.sendStageMessage(p.runId, p.instanceId, p.prompt, p.files, p.mode),
    meta: { errorTitle: 'Message not sent' },
    onSettled: (_data, _err, { runId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) });
    },
  });
}

/** Stop a stage's turn in flight; the stage carries on. */
export function useCancelStageTurn() {
  const platform = usePlatform() as HttpPlatformClient;
  return useMutation({
    mutationFn: (p: { runId: string; instanceId: string; force?: boolean }) =>
      platform.cancelStageTurn(p.runId, p.instanceId, p.force ? { force: true } : {}),
    meta: { errorTitle: 'Could not stop the turn' },
  });
}

/** Answer a stage's in-turn gate (tool permission, question, plan review). */
export function useResolveStageInteraction() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (p: { runId: string; instanceId: string; interactionId: string; answer: Parameters<HttpPlatformClient['resolveStageInteraction']>[3] }) =>
      platform.resolveStageInteraction(p.runId, p.instanceId, p.interactionId, p.answer),
    meta: { errorTitle: 'Answer not sent' },
    onSettled: (_data, _err, { runId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) });
    },
  });
}

/** Change the run row's permission mode (W-65); stages read it from their next turn. */
export function useSetRunPermissionMode() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (p: { runId: string; mode: WorkflowRunPermissionMode }) => platform.setPermissionMode(p.runId, p.mode),
    meta: { errorTitle: 'Permission mode not changed' },
    onSettled: (_data, _err, { runId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) });
    },
  });
}

/**
 * Get workspace/artifact files for a run. Polled while the run is live
 * only: a finished run's workspace no longer changes (D-24).
 */
export function useRunWorkspace(runId: string | undefined, opts: { live?: boolean } = {}) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: workflowKeys.runWorkspace(runId ?? ''),
    queryFn: () => platform.getRunWorkspace(runId!),
    enabled: !!runId,
    refetchInterval: opts.live ? 10_000 : false,
  });
}

/** Get file content for viewing */
export function useRunFileContent(
  runId: string | undefined,
  filePath: string | undefined,
  source: 'workspace' | 'artifacts' | 'uploads' | 'worktree',
  worktreeAlias?: string,
) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['run-file-content', runId, filePath, source, worktreeAlias],
    queryFn: () => platform.getRunFileContent(runId!, filePath!, source, worktreeAlias),
    enabled: !!runId && !!filePath,
    staleTime: 60_000,
  });
}

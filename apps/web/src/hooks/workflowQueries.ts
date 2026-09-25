// ────────────────────────────────────────────────────────────────
// TanStack Query hooks — Workflow Definitions and Runs
// All mutations invalidate relevant query caches automatically
// ────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';
import type { HttpPlatformClient } from '../platform/HttpPlatformClient.js';
import type { CreateWorkflowRunParams } from '@generatorai/shared';
import type { ForkRunRequest, RunCommand, WorkflowDefinitionRecord, WorkflowGraphInput } from '@generatorai/workflow-spec';
import type { StageOverrideWire } from '@generatorai/client-core';

// ── Query Keys ──
export const workflowKeys = {
  definitions: ['workflow-definitions'] as const,
  definition: (id: string) => ['workflow-definition', id] as const,
  definitionVersion: (id: string, versionId: string) => ['workflow-definition', id, 'version', versionId] as const,
  runs: ['workflow-runs'] as const,
  runsByDefinition: (defId: string) => ['workflow-runs', 'by-definition', defId] as const,
  run: (id: string) => ['workflow-run', id] as const,
  runWorkspace: (runId: string) => ['run-workspace', runId] as const,
  runScratchpad: (runId: string) => ['run-scratchpad', runId] as const,
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

/** List all workflow runs, optionally filtered by definition or status */
export function useWorkflowRuns(filter?: { definitionId?: string; status?: string }) {
  const platform = usePlatform();
  return useQuery({
    queryKey: [...workflowKeys.runs, filter?.definitionId ?? 'all', filter?.status ?? 'all'],
    queryFn: () => platform.listRuns(filter),
    refetchInterval: 15_000,
  });
}

/** List workflow runs for a specific definition */
export function useWorkflowRunsByDefinition(definitionId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.runsByDefinition(definitionId ?? ''),
    queryFn: () => platform.listRuns({ definitionId: definitionId! }),
    enabled: !!definitionId,
    refetchInterval: 15_000,
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

/** Create a new workflow run */
export function useCreateWorkflowRun() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateWorkflowRunParams) => platform.createRun(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
    },
  });
}

/** Start a created workflow run */
export function useStartWorkflowRun() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platform.startRun(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(id) });
    },
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
    onSettled: (_data, _err, { runId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) });
    },
  });
}

/**
 * Fork a terminal run (WP-3.8): a NEW run re-executes every instance that did
 * not complete (or `rerunFrom` and everything downstream); completed ones are
 * memoized. Resolves with the fork, which callers navigate to.
 */
export function useForkRun() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ runId, request }: { runId: string; request?: ForkRunRequest }) =>
      platform.forkRun(runId, request ?? {}),
    onSuccess: (_fork, { runId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// Orchestrator Queries & Mutations
// ════════════════════════════════════════════════════════════════

/** Start an orchestrated workflow run (with project codebases + preprocessing) */
export function useStartOrchestratedRun() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      workflowDefinitionId: string;
      variables?: Record<string, unknown>;
      projectId?: string;
      selectedCodebases?: string[];
      uploads?: { prompts: File[]; skills: File[]; agents: File[] };
      stageOverrides?: StageOverrideWire[];
      testRun?: boolean;
    }) => platform.startOrchestratedRun(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
    },
  });
}

/** Get workspace/artifact files for a run */
export function useRunWorkspace(runId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: workflowKeys.runWorkspace(runId ?? ''),
    queryFn: () => platform.getRunWorkspace(runId!),
    enabled: !!runId,
    refetchInterval: 10_000,
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

/**
 * Read the aggregated per-run scratchpad. Each stage's full output text
 * (Claude's response, or a structured JSON block) is aggregated here by
 * `stageRunId`. Used to populate the Inspector's Output tab with the
 * substantive stage output that isn't stored on the DB StageRun row.
 *
 * While the run is active we poll every 3 s so live output shows up in
 * the panel. Terminal runs cache for a minute.
 */
export function useRunScratchpad(runId: string | undefined, opts?: { isRunning?: boolean }) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: workflowKeys.runScratchpad(runId ?? ''),
    queryFn: () => platform.getRunScratchpad(runId!),
    enabled: !!runId,
    staleTime: opts?.isRunning ? 0 : 60_000,
    refetchInterval: opts?.isRunning ? 3_000 : false,
  });
}

/** Upload files (skills/agents/prompts) for a run */
export function useUploadRunFiles() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      runId: string;
      category: 'skills' | 'agents' | 'prompts';
      files: File[];
    }) => platform.uploadRunFiles(params.runId, params.category, params.files),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runWorkspace(variables.runId) });
    },
  });
}

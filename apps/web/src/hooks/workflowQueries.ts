// ────────────────────────────────────────────────────────────────
// TanStack Query hooks — Workflow Definitions, Stages, Edges, Runs
// All mutations invalidate relevant query caches automatically
// ────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';
import type { HttpPlatformClient } from '../platform/HttpPlatformClient.js';
import type {
  CreateWorkflowDefinitionParams,
  CreateWorkflowRunParams,
  CreateStageParams,
  CreateEdgeParams,
  StageEdgeType,
  ImportWorkflowJson,
} from '@generatorai/shared';

// ── Query Keys ──
export const workflowKeys = {
  definitions: ['workflow-definitions'] as const,
  definition: (id: string) => ['workflow-definition', id] as const,
  runs: ['workflow-runs'] as const,
  runsByDefinition: (defId: string) => ['workflow-runs', 'by-definition', defId] as const,
  run: (id: string) => ['workflow-run', id] as const,
  runWorkspace: (runId: string) => ['run-workspace', runId] as const,
  runScratchpad: (runId: string) => ['run-scratchpad', runId] as const,
};

// ════════════════════════════════════════════════════════════════
// Definition Queries & Mutations
// ════════════════════════════════════════════════════════════════

/** List all workflow definitions */
export function useWorkflowDefinitions() {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.definitions,
    queryFn: () => platform.listDefinitions(),
    staleTime: 30_000,
  });
}

/** Get a single workflow definition with stages and edges */
export function useWorkflowDefinition(id: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: workflowKeys.definition(id ?? ''),
    queryFn: () => platform.getDefinition(id!),
    enabled: !!id,
  });
}

/** Create a new workflow definition */
export function useCreateWorkflowDefinition() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateWorkflowDefinitionParams) => platform.createDefinition(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions });
    },
  });
}

/** Update a workflow definition */
export function useUpdateWorkflowDefinition() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { id: string; params: Partial<CreateWorkflowDefinitionParams> }) =>
      platform.updateDefinition(args.id, args.params),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions });
      queryClient.invalidateQueries({ queryKey: workflowKeys.definition(args.id) });
    },
  });
}

/** Delete a workflow definition */
export function useDeleteWorkflowDefinition() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platform.deleteDefinition(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions });
    },
  });
}

/**
 * Bulk-delete multiple workflow definitions in parallel.
 * Calls the single-delete endpoint for each ID and invalidates the
 * definitions cache once after all deletions complete.
 */
export function useBulkDeleteWorkflowDefinitions() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => platform.deleteDefinition(id)),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        throw new Error(`Failed to delete ${failed.length} of ${ids.length} workflows`);
      }
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

/** Import a full workflow from a JSON configuration */
export function useImportFromJSON() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ImportWorkflowJson) => platform.importFromJSON(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// Stage Mutations
// ════════════════════════════════════════════════════════════════

/** Add a stage to a workflow definition */
export function useAddStage() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { definitionId: string; params: Omit<CreateStageParams, 'workflowDefinitionId'> }) =>
      platform.addStage(args.definitionId, args.params),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definition(args.definitionId) });
    },
  });
}

/** Update a stage */
export function useUpdateStage() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      definitionId: string;
      stageId: string;
      params: Partial<Omit<CreateStageParams, 'workflowDefinitionId'>>;
    }) => platform.updateStage(args.definitionId, args.stageId, args.params),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definition(args.definitionId) });
    },
  });
}

/** Delete a stage */
export function useDeleteStage() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { definitionId: string; stageId: string }) =>
      platform.deleteStage(args.definitionId, args.stageId),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definition(args.definitionId) });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// Edge Mutations
// ════════════════════════════════════════════════════════════════

/** Add an edge between stages */
export function useAddEdge() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      definitionId: string;
      params: { fromStageId: string; toStageId: string; edgeType?: StageEdgeType };
    }) => platform.addEdge(args.definitionId, args.params),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definition(args.definitionId) });
    },
  });
}

/** Delete an edge */
export function useDeleteEdge() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { definitionId: string; edgeId: string }) =>
      platform.deleteEdge(args.definitionId, args.edgeId),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definition(args.definitionId) });
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

/** Pause a running workflow run */
export function usePauseWorkflowRun() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platform.pauseRun(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(id) });
    },
  });
}

/** Resume a paused workflow run */
export function useResumeWorkflowRun() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platform.resumeRun(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(id) });
    },
  });
}

/** Cancel a running/paused workflow run */
export function useCancelWorkflowRun() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platform.cancelRun(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(id) });
    },
  });
}

/** PARITY-1: retry a failed workflow run (run-level) */
export function useRetryWorkflowRun() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => platform.retryRun(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(id) });
    },
  });
}

// ── PARITY-2: per-stage controls (pause/resume/retry/cancel a single stage) ──

type StageControlArgs = { runId: string; stageId: string };

function useStageControl(action: (runId: string, stageId: string) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, stageId }: StageControlArgs) => action(runId, stageId),
    onSuccess: (_data, { runId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
      queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) });
    },
  });
}

/** Wake a single sleeping stage ahead of its scheduled wake time */
export function useWakeStageRun() {
  const platform = usePlatform();
  return useStageControl((runId, stageId) => platform.wakeStageRun(runId, stageId));
}

/** Retry a single failed stage */
export function useRetryStageRun() {
  const platform = usePlatform();
  return useStageControl((runId, stageId) => platform.retryStageRun(runId, stageId));
}

// ════════════════════════════════════════════════════════════════
// Orchestrator Queries & Mutations
// ════════════════════════════════════════════════════════════════

/** Create a workflow definition from a template (`POST /workflow-definitions/import`) */
export function useCreateFromTemplate() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { templateId: string; name?: string }) =>
      platform.importFromTemplate(args.templateId, args.name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions });
    },
  });
}

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
      stageOverrides?: Array<{ stageName?: string; stageIndex?: number; agentName?: string; contextFilter?: string; timeoutMs?: number; variables?: Record<string, unknown>; skip?: boolean }>;
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

// ── Workflow-Level File Management ──

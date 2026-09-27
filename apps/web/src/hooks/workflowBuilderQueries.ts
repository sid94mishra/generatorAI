// ────────────────────────────────────────────────────────────────
// Data hooks of the workflow builder (features/workflows/builder, PW-b):
// the calls the builder made through the platform client directly — server
// validation of the working graph, JSON export, a pinned version's graph
// (restore), the latest run's values (expression hover) and writing a
// definition into the cache (a 409's "Reload theirs"). Features never hold
// the platform client or the query client (D-04).
// ────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { evaluateSource } from '@generatorai/workflow-spec';
import type { WorkflowDefinitionRecord, WorkflowGraph, ValidationIssue } from '@generatorai/workflow-spec';
import type { WorkflowRun } from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';
import type { HttpPlatformClient } from '../platform/HttpPlatformClient.js';
import { ApiError } from '../platform/apiFetch.js';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore.js';
import { workflowKeys } from './workflowQueries.js';

/** `(graph) => server issues` — the server's validation (agents, models, capabilities, child workflows). */
export function useValidateDefinitionGraph(): (graph: WorkflowGraph) => Promise<{ issues: ValidationIssue[] }> {
  const platform = usePlatform();
  return useCallback((graph: WorkflowGraph) => platform.validateDefinitionGraph(graph), [platform]);
}

/** `(definitionId) => JSON text` — the canonical export of the SAVED graph. */
export function useExportDefinition(): (definitionId: string) => Promise<string> {
  const platform = usePlatform();
  return useCallback((definitionId: string) => platform.exportDefinition(definitionId), [platform]);
}

/** `(definitionId, versionId) => record` — one immutable version (cached forever). */
export function useFetchDefinitionVersion(): (definitionId: string, versionId: string) => Promise<WorkflowDefinitionRecord> {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useCallback(
    (definitionId: string, versionId: string) =>
      queryClient.fetchQuery({
        queryKey: workflowKeys.definitionVersion(definitionId, versionId),
        queryFn: () => platform.getDefinitionVersion(definitionId, versionId),
        staleTime: Infinity,
      }),
    [platform, queryClient],
  );
}

/** `(record) => void` — write a definition into the detail cache (loading a 409's current record). */
export function useSetDefinitionCache(): (record: WorkflowDefinitionRecord) => void {
  const queryClient = useQueryClient();
  return useCallback((record: WorkflowDefinitionRecord) => queryClient.setQueryData(workflowKeys.definition(record.id), record), [queryClient]);
}

export interface SaveFailure {
  /** HTTP status of an API error (409 revision conflict, 422 invalid graph). */
  status?: number;
  /** A 409's current record (offered as "Reload theirs" / "Overwrite"). */
  current?: WorkflowDefinitionRecord;
  /** A 422's validation issues. */
  issues?: ValidationIssue[];
}

/** What a failed save/create says about itself (features never import the platform's error class). */
export function saveFailure(err: unknown): SaveFailure {
  if (!(err instanceof ApiError)) return {};
  const details = err.details as { current?: WorkflowDefinitionRecord; issues?: ValidationIssue[] } | undefined;
  return {
    status: err.status,
    ...(details?.current ? { current: details.current } : {}),
    ...(details?.issues ? { issues: details.issues } : {}),
  };
}

const STALE_MS = 30_000;

export interface LastRunValue {
  /** Which run the value comes from (its name and status). */
  label: string;
  /** The value, or undefined when the path has none in that run. */
  value: unknown;
}

/**
 * `(path) => value in the latest run` of the definition being edited, or
 * null when it has no run. Only what a run records at the top level is
 * known (variables, run, top-level stages); a loop or map path has no value.
 */
export function useLastRunValue(): (path: string) => Promise<LastRunValue | null> {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useCallback(
    async (path: string) => {
      const definitionId = useWorkflowBuilderStore.getState().definitionId;
      if (!definitionId) return null;
      const runs = await queryClient.fetchQuery({
        queryKey: workflowKeys.runsByDefinition(definitionId),
        queryFn: () => platform.listRuns({ definitionId }),
        staleTime: STALE_MS,
      });
      const latest = [...runs].sort(
        (a: WorkflowRun, b: WorkflowRun) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
      if (!latest) return null;
      const run = await queryClient.fetchQuery({
        queryKey: workflowKeys.run(latest.id),
        queryFn: () => platform.getRun(latest.id),
        staleTime: STALE_MS,
      });
      const stages: Record<string, unknown> = {};
      for (const sr of run.stageRuns) {
        if (sr.scopeId) continue;
        stages[sr.stageKey] = { status: sr.status, output: sr.outputData ?? sr.outputText ?? null, summary: sr.summary ?? null };
      }
      const scope = {
        variables: run.variables ?? {},
        run: { id: run.id, name: run.name, codebases: run.systemVars?.codebases ?? {} },
        stages,
      };
      const root = path.split('.')[0] ?? '';
      const label = `${run.name}, ${run.status}`;
      if (!(root in scope)) return { label, value: undefined };
      const r = evaluateSource(path, scope);
      return { label, value: r.ok ? r.value : undefined };
    },
    [platform, queryClient],
  );
}

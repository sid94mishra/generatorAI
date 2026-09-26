// ────────────────────────────────────────────────────────────────
// Run and stage control mutations: run commands (`POST /commands`) and forks.
//
// Commands need `runControl` (write:workflows + exec:agent) EXCEPT
// `approve`, which the route policy lets through on exec:agent alone
// (answering the agent). A fork is a new invocation
// (`POST /workflow-invocations`, target `fork`), so it needs only
// `runStart`. Every mutation refetches the run on settle; the server is the
// only authority on what state the run landed in (a 409 means another
// device or the sweeper got there first, which the refetch then shows). A
// finished run is never mutated: retrying it forks a NEW run.
// ────────────────────────────────────────────────────────────────

import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  newIdempotencyKey,
  queryKeys,
  type ApprovalOutcome,
  type StageRunSummary,
  type WorkflowRunSummary,
} from '@generatorai/client-core';

import type { InvocationRequest } from '@generatorai/workflow-spec';

import { useAdminApi } from './useAdminApi';
import { useApi } from './useApi';
import { haptics } from '../components/ui/haptics';
import { isTerminal } from '../components/runs/statusStyle';
import {
  permissionModeOf,
  type RunPermissionMode,
} from '../components/runs/permissionMode';

/** Cache key for a run's permission mode — under the run so run invalidation refreshes it. */
export const runPermissionModeKey = (runId: string) => [...queryKeys.run(runId), 'permission-mode'] as const;

export type RunAction = 'pause' | 'resume' | 'cancel' | 'retry';
export type StageAction = 'retry' | 'resume' | 'cancel';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A fork of a finished run: pinned definition, fresh workspace. */
function forkRequest(sourceRunId: string, rerunFrom?: string[]): InvocationRequest {
  return {
    target: {
      kind: 'fork',
      sourceRunId,
      definition: 'pinned',
      workspace: 'fresh',
      ...(rerunFrom ? { rerunFrom } : {}),
    },
    variables: {},
    client: 'mobile',
  };
}

export function useRunMutations(runId: string) {
  const api = useApi();
  const admin = useAdminApi();
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.runs(), exact: true }),
    ]);

  const runAction = useMutation({
    mutationFn: async (action: RunAction): Promise<{ newRunId?: string }> => {
      if (action === 'retry') {
        // "Retry failed": a NEW run re-runs every stage that did not complete.
        const fork = await admin.workflows.invoke(forkRequest(runId), { idempotencyKey: newIdempotencyKey() });
        return { newRunId: fork.runId };
      }
      // Pause in `interrupt` mode so in-flight stages pause too.
      await admin.runs.command(
        runId,
        action === 'pause' ? { command: 'pause', mode: 'interrupt' } : { command: action },
      );
      return {};
    },
    onSuccess: () => haptics.commit(),
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not update the run', errorText(err));
    },
    onSettled: refresh,
  });

  const stageAction = useMutation({
    mutationFn: async ({ stageRunId, action }: { stageRunId: string; action: StageAction }): Promise<{ newRunId?: string }> => {
      const run = queryClient.getQueryData<WorkflowRunSummary & { stageRuns: StageRunSummary[] }>(
        queryKeys.run(runId),
      );
      if (action === 'retry' && run && isTerminal(run.status)) {
        // A stage of a finished run re-runs from that stage in a fork.
        const stage = run.stageRuns.find((s) => s.id === stageRunId);
        const fork = await admin.workflows.invoke(
          forkRequest(runId, [stage?.instancePath ?? stage?.stageKey ?? stageRunId]),
          { idempotencyKey: newIdempotencyKey() },
        );
        return { newRunId: fork.runId };
      }
      await admin.runs.command(
        runId,
        action === 'retry'
          ? { command: 'retry', instanceId: stageRunId, mode: 'resume' }
          : { command: action, instanceId: stageRunId },
      );
      return {};
    },
    onSuccess: ({ newRunId }) => {
      haptics.commit();
      if (newRunId && newRunId !== runId) router.push(`/runs/${newRunId}` as never);
    },
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not update the stage', errorText(err));
    },
    onSettled: refresh,
  });

  const approve = useMutation({
    mutationFn: (input: { stageRunId: string; outcome: ApprovalOutcome; feedback?: string }) =>
      api.runs.command(runId, {
        command: 'approve',
        instanceId: input.stageRunId,
        outcome: input.outcome,
        ...(input.feedback ? { feedback: input.feedback } : {}),
      }),
    onSuccess: (_data, input) => {
      if (input.outcome === 'approved') haptics.success();
      else haptics.commit();
    },
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not submit', errorText(err));
    },
    onSettled: refresh,
  });

  /** Deletes the run (the server cancels it first if it is still active). */
  const remove = useMutation({
    mutationFn: () => admin.runs.remove(runId),
    onSuccess: () => {
      haptics.commit();
      queryClient.removeQueries({ queryKey: queryKeys.run(runId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs() });
    },
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not delete the run', errorText(err));
    },
  });

  return { runAction, stageAction, approve, remove };
}

/**
 * The run's HITL permission mode and the mutation that flips it mid-run.
 * Reading needs only `read:workflows`; `enabled` lets the caller skip the
 * request for a run that is already over.
 */
export function useRunPermissionMode(runId: string, enabled: boolean) {
  const admin = useAdminApi();
  const queryClient = useQueryClient();
  const key = runPermissionModeKey(runId);

  const mode = useQuery({
    queryKey: key,
    queryFn: async () => permissionModeOf(await admin.runs.permissionMode.get(runId)),
    enabled,
    staleTime: 30_000,
  });

  const setMode = useMutation({
    mutationFn: async (next: RunPermissionMode) =>
      permissionModeOf(await admin.runs.permissionMode.set(runId, next)),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RunPermissionMode>(key);
      queryClient.setQueryData(key, next);
      return { previous };
    },
    onSuccess: (confirmed) => {
      haptics.commit();
      queryClient.setQueryData(key, confirmed);
    },
    onError: (err, _next, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      haptics.error();
      Alert.alert('Could not change permissions', errorText(err));
    },
  });

  return { mode, setMode };
}

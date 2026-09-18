// ────────────────────────────────────────────────────────────────
// Run and stage control mutations.
//
// All of these need `runControl` (write:workflows + exec:agent) EXCEPT
// `approve`, which the route policy classifies as answering the agent
// (exec:agent only). Every mutation refetches the run on settle; the server
// is the only authority on what state the run landed in (a 409 means another
// device or the sweeper got there first, which the refetch then shows).
// ────────────────────────────────────────────────────────────────

import { Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ApprovalOutcome } from '@generatorai/client-core';

import { useAdminApi } from './useAdminApi';
import { useApi } from './useApi';
import { haptics } from '../components/ui/haptics';
import {
  permissionModeOf,
  type RunPermissionMode,
} from '../components/runs/permissionMode';

/** Cache key for a run's permission mode — under the run so run invalidation refreshes it. */
export const runPermissionModeKey = (runId: string) => [...queryKeys.run(runId), 'permission-mode'] as const;

export type RunAction = 'pause' | 'resume' | 'cancel' | 'retry';
export type StageAction = 'retry' | 'resume' | 'wake' | 'cancel';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
      const result = (await admin.runs[action](runId)) as unknown;
      // Retry creates a NEW run (the old one stays as its ancestor).
      const newRunId =
        action === 'retry' && result && typeof result === 'object'
          ? (result as { runId?: unknown }).runId
          : undefined;
      return typeof newRunId === 'string' ? { newRunId } : {};
    },
    onSuccess: () => haptics.commit(),
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not update the run', errorText(err));
    },
    onSettled: refresh,
  });

  const stageAction = useMutation({
    mutationFn: ({ stageRunId, action }: { stageRunId: string; action: StageAction }) =>
      admin.runs.stage[action](runId, stageRunId),
    onSuccess: () => haptics.commit(),
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not update the stage', errorText(err));
    },
    onSettled: refresh,
  });

  const approve = useMutation({
    mutationFn: (input: { stageRunId: string; outcome: ApprovalOutcome; feedback?: string }) =>
      api.runs.approve(runId, input.stageRunId, {
        outcome: input.outcome,
        approved: input.outcome === 'approved',
        ...(input.feedback
          ? input.outcome === 'rejected'
            ? { reason: input.feedback }
            : { followUpPrompt: input.feedback }
          : {}),
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

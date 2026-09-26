// ────────────────────────────────────────────────────────────────
// Loop decisions (P05 WP-5A.5): the run commands that answer a parked loop —
// grant iterations, raise the budget, continue with input, accept, accept an
// earlier iteration, fail — and the loop's finished iterations.
//
// Same rules as `useRunControl`: every command needs `runControl`, a refusal
// (409 `checkpoint_unavailable`, a loop no longer parked, …) is shown to the
// operator, and the run refetches on settle — the server decides what state
// the loop landed in.
// ────────────────────────────────────────────────────────────────

import { Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';
import type { RunCommand } from '@generatorai/workflow-spec';

import { useAdminApi } from './useAdminApi';
import { haptics } from '../components/ui/haptics';
import { loopCommandError } from '../components/runs/loopModel';

/** The run commands a loop decision card sends. */
export type LoopCommand = Extract<
  RunCommand,
  { command: 'grant_iterations' | 'raise_budget' | 'continue_with_input' | 'accept' | 'accept_iteration' | 'fail' }
>;

/** Cache key for a loop's iterations — under the run so run invalidation refreshes it. */
export const loopIterationsKey = (runId: string, loopInstanceId: string) =>
  [...queryKeys.run(runId), 'loop-iterations', loopInstanceId] as const;

export function useLoopControl(runId: string) {
  const admin = useAdminApi();
  const queryClient = useQueryClient();

  const command = useMutation({
    mutationFn: (body: LoopCommand) => admin.runs.command(runId, body),
    onSuccess: () => haptics.commit(),
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not apply the decision', loopCommandError(err));
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.runs(), exact: true }),
      ]),
  });

  return { command };
}

/** A loop instance's finished iterations, oldest first; `enabled` defers the fetch until it is needed. */
export function useLoopIterations(runId: string, loopInstanceId: string, enabled: boolean) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: loopIterationsKey(runId, loopInstanceId),
    queryFn: () => admin.runs.iterations(runId, loopInstanceId),
    enabled,
    staleTime: 10_000,
  });
}

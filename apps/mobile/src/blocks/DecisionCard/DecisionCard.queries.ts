// MB-34 data: the loop decision commands (`POST /workflow-runs/:id/commands`: grant_iterations, raise_budget,
// continue_with_input, accept, accept_iteration, fail — run-time acts on `exec:agent`, P05) and a loop's finished
// iterations. Every command carries the parked loop's version (a stale card never acts on a later park, LOOP-R14);
// the run refetches on settle — the server decides where the loop landed.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';
import type { RunCommand } from '@generatorai/workflow-spec';

import { useAdminApi } from '../../services/api/useAdminApi';

export type LoopCommand = Extract<RunCommand, { command: 'grant_iterations' | 'raise_budget' | 'continue_with_input' | 'accept' | 'accept_iteration' | 'fail' }>;

export const loopIterationsKey = (runId: string, loopInstanceId: string) => [...queryKeys.run(runId), 'loop-iterations', loopInstanceId] as const;

export function useLoopCommand(runId: string) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: LoopCommand) => admin.runs.command(runId, body),
    onSettled: () => Promise.all([client.invalidateQueries({ queryKey: queryKeys.run(runId) }), client.invalidateQueries({ queryKey: queryKeys.runs(), exact: true })]),
  });
}

export function useLoopIterations(runId: string, loopInstanceId: string, enabled: boolean) {
  const admin = useAdminApi();
  return useQuery({ queryKey: loopIterationsKey(runId, loopInstanceId), queryFn: () => admin.runs.iterations(runId, loopInstanceId), enabled, staleTime: 10_000 });
}

// MB-07 data: the source-control results of settled turns (`turnId → ScmFlowResult`), folded from the chat's replay
// log. They exist only as stream events, and the live subscription starts at the live cursor, so a reopened chat
// would otherwise show its answers with no record of what was committed for them. The live stream invalidates the
// key when a `chat.scm.result` arrives (`services/stream/useChatStream`).
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { isTerminalRunStatus, mergeWorkflowRunCards, queryKeys, scmKeys, type WorkflowRunCardView } from '@generatorai/client-core';
import type { ScmFlowResult } from '@generatorai/shared';

import { useApi } from '../../services/api/useApi';
import { foldScmResults, type ReplayPage } from '../../services/stream/scmResults';

export function useScmResults(chatId: string | null | undefined): UseQueryResult<Map<string, ScmFlowResult>> {
  const api = useApi();
  return useQuery({
    queryKey: scmKeys.chatResults(chatId ?? ''),
    queryFn: () => foldScmResults((afterSeq) => api.replay('chat', chatId!, afterSeq) as Promise<ReplayPage>),
    enabled: Boolean(chatId),
    staleTime: 5_000,
  });
}

/**
 * MB-18 data: the runs this chat started (`GET /chats/:id/workflow-runs`, P06) — the REST list is the truth; the
 * chat stream folds `chat.workflow_run.*` into the same key between refetches (`useChatStream`). Polls while a run
 * is still going.
 */
export function useChatWorkflowRuns(chatId: string | null | undefined) {
  const api = useApi();
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.chatWorkflowRuns(chatId ?? ''),
    queryFn: async (): Promise<WorkflowRunCardView[]> => mergeWorkflowRunCards((await api.chats.workflowRuns(chatId!)).runs, client.getQueryData<WorkflowRunCardView[]>(queryKeys.chatWorkflowRuns(chatId!))),
    enabled: Boolean(chatId),
    staleTime: 15_000,
    refetchInterval: (query) => ((query.state.data ?? []).some((c) => !isTerminalRunStatus(c.status)) ? 15_000 : false),
  });
}

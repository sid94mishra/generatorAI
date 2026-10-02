// MB-07 data: the source-control results of settled turns (`turnId → ScmFlowResult`), folded from the chat's replay
// log. They exist only as stream events, and the live subscription starts at the live cursor, so a reopened chat
// would otherwise show its answers with no record of what was committed for them. The live stream invalidates the
// key when a `chat.scm.result` arrives (`services/stream/useChatStream`).
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { scmKeys } from '@generatorai/client-core';
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

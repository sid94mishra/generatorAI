// The React half of `scmResults.ts`: the fold, bound to the authenticated
// client-core client and cached by TanStack Query.
//
// Split for the same reason `useScmApi` is split from `api.ts` — the paging
// rule is testable in the node environment, and this file holds nothing but
// the wiring.

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ScmFlowResult } from '@generatorai/shared';

import { useApi } from '../../api/useApi';
import { scmKeys } from './api';
import { foldScmResults, type ReplayPage } from './scmResults';

/**
 * `turnId → ScmFlowResult` for every settled turn of this chat.
 *
 * `staleTime` is short on purpose: the live stream invalidates this key when
 * a `chat.scm.result` arrives (see `stream/useChatStream.ts`), and the few
 * seconds cover the window where a turn settles just as the screen mounts.
 */
export function useScmResults(
  chatId: string | null | undefined,
): UseQueryResult<Map<string, ScmFlowResult>> {
  const api = useApi();
  return useQuery({
    queryKey: scmKeys.chatResults(chatId ?? ''),
    queryFn: () =>
      foldScmResults((afterSeq) => api.replay('chat', chatId!, afterSeq) as Promise<ReplayPage>),
    enabled: Boolean(chatId),
    staleTime: 5_000,
  });
}

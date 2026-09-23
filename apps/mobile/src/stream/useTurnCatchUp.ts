// The React half of `turnCatchUp.ts`: decides ONCE per opened chat whether a
// turn was already running, and if so where its replay should start.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ChatMessage } from '@generatorai/client-core';

import { useApi } from '../api/useApi';
import type { ReplayPage } from '../components/scm/scmResults';
import { CATCH_UP_PAGE_SIZE, turnCatchUpRows, unansweredTurnId } from './turnCatchUp';

export interface TurnCatchUp {
  /** False until the subscription may open: history has loaded, and any catch-up lookup has settled. */
  ready: boolean;
  /** The running turn's logged events, to replay before the live ones. */
  events: ReadonlyArray<{ kind: string; data: Record<string, unknown> }> | undefined;
  /** The resume cursor for the subscription: the last replayed event. */
  afterSequence: number | undefined;
}

/**
 * Latched on the first history load: a prompt sent later from this screen is
 * already in the live stream, and re-deciding then would close and reopen
 * the subscription under it. `liveTurnId` is the turn the stream store is
 * already showing (a chat reopened within the same app session) — that turn
 * needs no replay, and replaying it would rebuild it twice.
 */
export function useTurnCatchUp(
  chatId: string,
  history: { data: readonly ChatMessage[] | undefined; settled: boolean },
  liveTurnId: string | null,
): TurnCatchUp {
  const api = useApi();
  const [turnId, setTurnId] = useState<string | null | undefined>(undefined);

  let latched = turnId;
  if (latched === undefined && history.settled) {
    const unanswered = unansweredTurnId(history.data);
    latched = unanswered && unanswered !== liveTurnId ? unanswered : null;
    setTurnId(latched);
  }

  const cursor = useQuery({
    queryKey: ['chats', chatId, 'turn-catch-up', latched ?? ''],
    queryFn: () =>
      turnCatchUpRows(
        (afterSeq) => api.replay('chat', chatId, afterSeq, CATCH_UP_PAGE_SIZE) as Promise<ReplayPage>,
        latched!,
      ),
    enabled: Boolean(latched),
    // The cursor only matters at subscribe time; never refetch it under a live subscription.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  const none = { events: undefined, afterSequence: undefined };
  if (latched === undefined) return { ready: false, ...none };
  if (latched === null) return { ready: true, ...none };
  if (cursor.isPending) return { ready: false, ...none };
  // A failed lookup opens the chat the way it always opened: at the live edge.
  if (!cursor.data) return { ready: true, ...none };
  return {
    ready: true,
    events: cursor.data.rows.map((row) => ({ kind: row.kind, data: row.payload ?? {} })),
    afterSequence: cursor.data.lastSeq,
  };
}

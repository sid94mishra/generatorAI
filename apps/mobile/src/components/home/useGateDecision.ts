// ────────────────────────────────────────────────────────────────
// useGateDecision — answer a chat gate from anywhere.
//
// The chat screen owns its own mutations; the Home queue, the approvals
// sheet and the gate route need the same three verbs without a transcript
// underneath them. One hook, the same invalidations the chat screen
// performs, and the same 409 rule: "already handled elsewhere" is not an
// error, it is the thing the queue removes the card for.
// ────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, queryKeys } from '@generatorai/client-core';

import { useApi } from '../../api/useApi';
import { toPlanDecision } from '../chat/gateActions';
import { haptics } from '../ui/haptics';
import { useToast } from '../ui/Toast';

export type DecisionOutcome = 'done' | 'already_handled';

export function useGateDecision() {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();

  const settle = useCallback(
    (chatId: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatInteractions(chatId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatPlans(chatId) });
    },
    [queryClient],
  );

  const run = useCallback(
    async (chatId: string, call: () => Promise<unknown>, success: string): Promise<DecisionOutcome> => {
      try {
        await call();
        haptics.success();
        toast({ message: success, tone: 'success' });
        settle(chatId);
        return 'done';
      } catch (error) {
        settle(chatId);
        // 409: another device or the web app answered first. The card is
        // gone either way, so say so rather than "failed".
        if (error instanceof ApiError && error.status === 409) {
          toast({ message: 'Already handled elsewhere.', tone: 'info' });
          return 'already_handled';
        }
        haptics.error();
        toast({ message: 'Could not send that decision. Try again.', tone: 'error' });
        throw error;
      }
    },
    [settle, toast],
  );

  const permission = useCallback(
    (chatId: string, interactionId: string, behavior: 'allow' | 'deny', message?: string) =>
      run(
        chatId,
        () =>
          api.chats.respondPermission(chatId, interactionId, {
            behavior,
            ...(message ? { message } : {}),
          }),
        behavior === 'allow' ? 'Allowed.' : 'Denied.',
      ),
    [api, run],
  );

  const answer = useCallback(
    (
      chatId: string,
      interactionId: string,
      answers: Record<string, string[]>,
      freeformResponse?: string,
    ) =>
      run(
        chatId,
        () =>
          api.chats.respond(chatId, interactionId, {
            answers,
            ...(freeformResponse ? { freeformResponse } : {}),
          }),
        'Answer sent.',
      ),
    [api, run],
  );

  const plan = useCallback(
    (chatId: string, planId: string, actionId: string, feedback?: string) =>
      run(
        chatId,
        () => api.chats.decidePlan(chatId, planId, toPlanDecision(actionId, feedback)),
        'Decision sent.',
      ),
    [api, run],
  );

  return { permission, answer, plan };
}

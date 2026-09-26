// ────────────────────────────────────────────────────────────────
// useChatGates — the turn's blocking gates (plan review, questions, tool
// permissions) and the chat's agent mode (PLN-01).
//
// Card decisions are applied to the stream store OPTIMISTICALLY, for instant
// feedback and to close a race: the pending-gate poll can observe a resolved
// gate before the `chat.plan.decided` / `chat.question.answered` event lands,
// and the reconciliation below would then wrongly mark the card expired.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentMode } from '@generatorai/shared';
import { DEFAULT_AGENT_MODE } from '@generatorai/shared';
import {
  useAnswerPermission,
  useAnswerQuestion,
  useDecidePlan,
  usePendingInteractions,
} from '@/hooks/queries.js';
import { useStreamStore } from '@/stores/streamStore.js';

export type PlanImplementAction = 'implement_interactive' | 'implement_autopilot';

export interface UseChatGatesOptions {
  chatId: string | undefined;
  sessionId: string | undefined;
  /** Gates are only polled for an active chat. */
  chatActive: boolean;
  /** The chat's sticky default mode, when it has one. */
  defaultAgentMode: AgentMode | undefined;
  /** Changes when a question/permission/plan block appears or changes status. */
  interactionBlocksKey: string;
}

export function useChatGates({
  chatId,
  sessionId,
  chatActive,
  defaultAgentMode,
  interactionBlocksKey,
}: UseChatGatesOptions) {
  // Sticky per-chat default, overridable per turn from the composer.
  const [agentMode, setAgentMode] = useState<AgentMode>(DEFAULT_AGENT_MODE);
  useEffect(() => {
    if (defaultAgentMode) setAgentMode(defaultAgentMode);
  }, [defaultAgentMode]);

  const decidePlan = useDecidePlan(chatId ?? '');
  const answerQuestion = useAnswerQuestion(chatId ?? '');
  const answerPermission = useAnswerPermission(chatId ?? '');
  // The blocking promise lives server-side, so polling rehydrates the gate
  // after a reload even when the SSE replay window has moved on.
  const { data: pendingInteractions, dataUpdatedAt: pendingFetchedAt } = usePendingInteractions(
    chatId,
    chatActive,
  );
  const pendingGate = pendingInteractions?.[0];

  const approvePlan = useCallback(
    (planId: string, action: PlanImplementAction) => {
      if (sessionId) {
        useStreamStore.getState().setPlanStatus(sessionId, planId, 'approved');
      }
      decidePlan.mutate({ planId, approved: true, action });
    },
    [decidePlan, sessionId],
  );

  const requestPlanChanges = useCallback(
    (planId: string, feedback: string) => {
      if (sessionId) {
        useStreamStore.getState().setPlanStatus(sessionId, planId, 'changes_requested');
      }
      decidePlan.mutate({ planId, approved: false, feedback });
    },
    [decidePlan, sessionId],
  );

  const answerQuestionGate = useCallback(
    (interactionId: string, answers: Record<string, string[]>, freeformResponse?: string) => {
      if (sessionId) {
        useStreamStore.getState().answerQuestion(sessionId, interactionId, answers, freeformResponse);
      }
      answerQuestion.mutate({
        interactionId,
        answers,
        ...(freeformResponse ? { freeformResponse } : {}),
      });
    },
    [answerQuestion, sessionId],
  );

  const answerPermissionGate = useCallback(
    (interactionId: string, behavior: 'allow' | 'deny', message?: string) => {
      if (sessionId) {
        useStreamStore.getState().resolvePermission(sessionId, interactionId, behavior, message);
      }
      answerPermission.mutate({
        interactionId,
        behavior,
        ...(message ? { message } : {}),
      });
    },
    [answerPermission, sessionId],
  );

  /** Human-readable reason the composer is blocked, if it is. */
  const pendingInteractionLabel = useMemo(() => {
    if (!pendingGate) return null;
    if (pendingGate.kind === 'plan_review') {
      return 'Waiting on your plan review before the agent can continue.';
    }
    if (pendingGate.kind === 'tool_permission') {
      return 'The agent is waiting for you to allow or deny a tool call.';
    }
    return 'The agent is waiting for your answer.';
  }, [pendingGate]);

  // Reconcile optimistic card state against the server's pending gates.
  //
  // A card is rendered "pending" from a live SSE event, but the gate can die
  // server-side without the client hearing about it — a server restart expires
  // every in-flight chat gate, and the event can also fall outside the replay
  // window. The pending list is authoritative — but only about gates that
  // already existed when it was fetched: it polls on an interval, so a card
  // opened by SSE moments ago is legitimately absent from the last response.
  // Comparing the card's `openedAt` with the poll's fetch time keeps a stale
  // poll from instantly killing a live gate.
  useEffect(() => {
    if (!sessionId || pendingInteractions === undefined) return;
    const live = new Set(pendingInteractions.map((i) => i.interactionId));
    const store = useStreamStore.getState();
    const isStale = (openedAt: number | undefined) =>
      openedAt !== undefined && openedAt > pendingFetchedAt;
    for (const block of store.streams[sessionId]?.blocks ?? []) {
      if (
        block.type === 'question' &&
        block.status === 'pending' &&
        !live.has(block.interactionId) &&
        !isStale(block.openedAt)
      ) {
        store.expireQuestion(sessionId, block.interactionId);
      }
      if (
        block.type === 'plan' &&
        block.status === 'awaiting_review' &&
        block.interactionId &&
        !live.has(block.interactionId) &&
        !isStale(block.openedAt)
      ) {
        store.setPlanStatus(sessionId, block.planId, 'expired');
      }
      if (
        block.type === 'permission' &&
        block.status === 'pending' &&
        !live.has(block.interactionId) &&
        !isStale(block.openedAt)
      ) {
        store.expirePermission(sessionId, block.interactionId);
      }
    }
  }, [sessionId, pendingInteractions, pendingFetchedAt, interactionBlocksKey]);

  return {
    agentMode,
    setAgentMode,
    approvePlan,
    requestPlanChanges,
    answerQuestion: answerQuestionGate,
    answerPermission: answerPermissionGate,
    /** A card decision is in flight. */
    decisionBusy: decidePlan.isPending || answerQuestion.isPending || answerPermission.isPending,
    pendingInteractionLabel,
  };
}

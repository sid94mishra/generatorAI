// ────────────────────────────────────────────────────────────────
// useStageConversation — a stage is a compact chat (P03b).
//
// The stage conversation API's mutations: send a message (queued between
// turns, an amendment of a completed stage, a retry of a paused one), stop
// the turn in flight, and answer an in-turn gate (tool permission, question,
// plan review) in the chat's shapes. A refusal is the server's own sentence
// (409 STAGE_BUSY mid-turn, INTERACTION_PENDING while a gate waits, …) shown
// as the chat shows its send errors: a toast. Every mutation refetches the run.
// ────────────────────────────────────────────────────────────────

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type AgentMode, type StageMessageResult } from '@generatorai/client-core';

import { useAuth } from '../auth/AuthProvider';
import { useApi } from './useApi';
import type { ChatUpload } from './sendChatPrompt';
import { sendStageMessage } from './sendStageMessage';
import { haptics } from '../components/ui/haptics';
import { useToast } from '../components/ui/Toast';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What the phone says once a message was taken. */
export const SEND_OUTCOME_TEXT: Record<StageMessageResult['outcome'], string> = {
  queued: 'Sent — the stage takes it as its next turn.',
  amending: 'Amending this stage’s output. Later stages keep what they already used.',
  retrying: 'The stage resumes with your message.',
};

export function useStageConversation(runId: string, stageRunId: string) {
  const { fetch } = useAuth();
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.stageTranscript(runId, stageRunId) }),
    ]);
  const fail = (err: unknown): void => {
    haptics.error();
    toast({ message: errorText(err), tone: 'error' });
  };

  const send = useMutation({
    mutationFn: (input: { message: string; mode?: AgentMode | undefined; files: ChatUpload[] }) =>
      sendStageMessage(fetch, runId, stageRunId, { message: input.message, ...(input.mode ? { mode: input.mode } : {}) }, input.files),
    onSuccess: (result) => {
      haptics.commit();
      toast({ message: SEND_OUTCOME_TEXT[result.outcome], tone: 'success' });
    },
    // No toast here: the composer restores the draft and its screen says why.
    onSettled: refresh,
  });

  const stop = useMutation({
    mutationFn: (options: { force?: boolean }) => api.runs.cancelStageTurn(runId, stageRunId, options),
    onSuccess: () => haptics.commit(),
    onError: fail,
    onSettled: refresh,
  });

  const permission = useMutation({
    mutationFn: (input: { interactionId: string; behavior: 'allow' | 'deny'; message?: string }) =>
      api.runs.stagePermission(runId, stageRunId, input.interactionId, {
        behavior: input.behavior,
        ...(input.message ? { message: input.message } : {}),
      }),
    onSuccess: (_d, input) => (input.behavior === 'allow' ? haptics.success() : haptics.commit()),
    onError: fail,
    onSettled: refresh,
  });

  const answer = useMutation({
    mutationFn: (input: { interactionId: string; answers: Record<string, string[]>; freeformResponse?: string }) =>
      api.runs.stageAnswer(runId, stageRunId, input.interactionId, {
        answers: input.answers,
        ...(input.freeformResponse ? { freeformResponse: input.freeformResponse } : {}),
      }),
    onSuccess: () => haptics.success(),
    onError: fail,
    onSettled: refresh,
  });

  const plan = useMutation({
    mutationFn: (input: {
      interactionId: string;
      approved: boolean;
      action?: 'exit_only' | 'implement_interactive' | 'implement_autopilot';
      feedback?: string;
    }) =>
      api.runs.stagePlan(runId, stageRunId, input.interactionId, {
        approved: input.approved,
        ...(input.action ? { action: input.action } : {}),
        ...(input.feedback ? { feedback: input.feedback } : {}),
      }),
    onSuccess: () => haptics.commit(),
    onError: fail,
    onSettled: refresh,
  });

  return { send, stop, permission, answer, plan, toastError: fail };
}

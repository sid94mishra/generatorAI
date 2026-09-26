// ────────────────────────────────────────────────────────────────
// The chat's workflow cards' data side (WF-13, P06 WP-6.2): answering a
// completion review from the transcript. The same `approve` run command the
// run page sends; on success the chat's run list drops the decision at once
// (the refetch confirms), so the approval card disappears without a flicker.
// ────────────────────────────────────────────────────────────────

import { useQueryClient } from '@tanstack/react-query';
import type { WorkflowRunCardView } from '@generatorai/client-core';
import { useRunCommand, workflowKeys } from './workflowQueries.js';

export type ChatRunApprovalOutcome = 'approved' | 'rejected' | 'changes_requested';

export interface ChatRunApprovalAnswer {
  runId: string;
  instanceId: string;
  outcome: ChatRunApprovalOutcome;
  /** Sent with Reject / Request changes; ignored for Approve. */
  feedback?: string;
}

/**
 * Answer a decision a chat's run is parked on. `answer` resolves `true` once
 * the command is accepted, `false` when it was refused (the mutation's global
 * handler has toasted the server's reason, D-13).
 */
export function useAnswerChatRunApproval(chatId: string | undefined) {
  const queryClient = useQueryClient();
  const command = useRunCommand();

  const answer = async ({ runId, instanceId, outcome, feedback }: ChatRunApprovalAnswer): Promise<boolean> => {
    const text = feedback?.trim();
    try {
      await command.mutateAsync({
        runId,
        command: {
          command: 'approve',
          instanceId,
          outcome,
          ...(outcome !== 'approved' && text ? { feedback: text } : {}),
        },
      });
    } catch {
      return false;
    }
    if (chatId) {
      // The decision is answered: drop it now, the refetch confirms.
      queryClient.setQueryData<{ runs: WorkflowRunCardView[] }>(workflowKeys.chatRuns(chatId), (old) =>
        old
          ? {
              runs: old.runs.map((r) =>
                r.runId === runId
                  ? { ...r, pendingApprovals: r.pendingApprovals.filter((p) => p.instanceId !== instanceId) }
                  : r,
              ),
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: workflowKeys.chatRuns(chatId) });
    }
    return true;
  };

  return { answer, isPending: command.isPending };
}

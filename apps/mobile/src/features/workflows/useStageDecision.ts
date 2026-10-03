// A stage's decision, signed (MB-50 / MB-34; MG-05, MD-31, MD-177): every workflow approval is risky until the server
// rates them (MG-34), so a completion review, an approval wait and an in-turn tool permission answered from this
// phone carry a fresh approval-key signature over exactly that decision — the system prompt shows every time (no
// step-up cache). Questions and plan reviews answer unsigned, as on a chat. Resolves when the server confirmed
// (success haptic, MD-78); rejects to keep the card pending — a cancelled prompt quietly, everything else with a
// toast in the server's words.
import { useCallback } from 'react';
import { ApiError } from '@generatorai/client-core';
import { STAGE_APPROVAL_DECISION } from '@generatorai/shared';

import { approvalFailureNote, useApprovalSigner, type ApprovalFailureCode, type ApprovalSigner } from '../../blocks/GateCard';
import { approvalRejection } from '../../services/auth/approvalSigning';
import { errorText } from '../../ui/lib/format';
import { haptic } from '../../ui/platform/haptics';
import { toast } from '../../ui/primitives/Toast';
import { useApproveStage, useStageConversation } from './queries';

export type StageOutcome = 'approved' | 'changes_requested' | 'rejected';

function prompt(outcome: StageOutcome, name: string): { title: string; subtitle: string; cancel: string } {
  const short = name.length > 50 ? `${name.slice(0, 47)}…` : name;
  if (outcome === 'approved') return { title: `Approve ${short}?`, subtitle: 'Verify it’s you to approve this stage.', cancel: 'Cancel' };
  if (outcome === 'rejected') return { title: `Reject ${short}?`, subtitle: 'Verify it’s you to reject this stage.', cancel: 'Cancel' };
  return { title: `Send changes to ${short}?`, subtitle: 'Verify it’s you to request changes.', cancel: 'Cancel' };
}

export function useStageDecision(
  runId: string,
  instanceId: string,
): {
  signer: ApprovalSigner;
  decide: (input: { outcome: StageOutcome; name: string; feedback?: string; data?: Record<string, unknown>; expectedVersion?: number }) => Promise<void>;
  permission: (input: { interactionId: string; behavior: 'allow' | 'deny'; risky: boolean; summary: string; message?: string }) => Promise<void>;
} {
  const signer = useApprovalSigner();
  const approve = useApproveStage(runId);
  const conversation = useStageConversation(runId, instanceId);

  const fail = useCallback(
    (error: unknown): never => {
      if ((error as { cancelled?: boolean }).cancelled) throw error;
      const code = (error as { approvalCode?: string }).approvalCode;
      if (code && code !== 'failed') {
        haptic('error');
        toast({ kind: 'error', message: approvalFailureNote(code as ApprovalFailureCode, 'sign', signer.noun) });
        throw error;
      }
      const rejection = approvalRejection(error);
      if (rejection === 'key-missing' || rejection === 'proof-required') {
        signer.refresh();
        toast({ kind: 'error', message: 'Register the approval key on this device to answer workflow approvals.' });
      } else if (rejection === 'proof-invalid') {
        toast({ kind: 'error', message: "The server couldn't verify that approval. Try again." });
      } else if (error instanceof ApiError && error.status === 409) {
        toast({ kind: 'background', message: 'Already decided — the run moved on.' });
      } else {
        haptic('error');
        toast({ kind: 'error', message: errorText(error) });
      }
      throw error;
    },
    [signer],
  );

  const decide = useCallback(
    async (input: { outcome: StageOutcome; name: string; feedback?: string; data?: Record<string, unknown>; expectedVersion?: number }) => {
      try {
        const approvalProof = await signer.sign({ gate: { kind: 'stage_approval', id: instanceId, entityId: runId }, decision: STAGE_APPROVAL_DECISION[input.outcome] }, prompt(input.outcome, input.name));
        await approve.mutateAsync({
          instanceId,
          outcome: input.outcome,
          ...(input.feedback ? { feedback: input.feedback } : {}),
          ...(input.data ? { data: input.data } : {}),
          ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
          approvalProof,
        });
        haptic(input.outcome === 'approved' ? 'success' : 'warning');
      } catch (error) {
        fail(error);
      }
    },
    [signer, runId, instanceId, approve, fail],
  );

  const permission = useCallback(
    async (input: { interactionId: string; behavior: 'allow' | 'deny'; risky: boolean; summary: string; message?: string }) => {
      try {
        const approvalProof = input.risky
          ? await signer.sign(
              { gate: { kind: 'tool_permission', id: input.interactionId, entityId: runId }, decision: input.behavior },
              input.behavior === 'allow'
                ? { title: `Approve "${input.summary.slice(0, 57)}"?`, subtitle: 'Verify it’s you to allow this risky action.', cancel: 'Cancel' }
                : { title: `Deny "${input.summary.slice(0, 57)}"?`, subtitle: 'Verify it’s you to answer this risky request.', cancel: 'Cancel' },
            )
          : undefined;
        await conversation.permission.mutateAsync({ interactionId: input.interactionId, behavior: input.behavior, ...(input.message ? { message: input.message } : {}), ...(approvalProof ? { approvalProof } : {}) });
        haptic(input.behavior === 'allow' ? 'success' : 'warning');
      } catch (error) {
        fail(error);
      }
    },
    [signer, runId, conversation.permission, fail],
  );

  return { signer, decide, permission };
}

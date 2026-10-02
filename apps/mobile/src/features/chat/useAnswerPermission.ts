// Answering a chat's permission gate (MB-15 / MB-50; MG-04, MG-05, MD-31): a risky gate (the server's verdict, or
// the shared rule for gates raised before it existed) is answered with a fresh signature by this device's approval
// key — the system prompt shows every time (no step-up cache, 06 §6.4). The chat screen and the approval sheet
// share it. Rejects when the answer did not land (the card stays pending); a cancelled prompt rejects quietly.
import { useCallback } from 'react';
import { ApiError, type StreamBlock } from '@generatorai/client-core';

import { approvalPrompt, permissionRisk, permissionView, useApprovalSigner, type ApprovalSigner } from '../../blocks/GateCard';
import { approvalRejection } from '../../services/auth/approvalSigning';
import { haptic } from '../../ui/platform/haptics';
import { toast } from '../../ui/primitives/Toast';
import { useResolveChatPermission } from './queries';

type PermissionBlock = Extract<StreamBlock, { type: 'permission' }>;

export function useAnswerPermission(
  chatId: string,
  streamKey: string,
): { answer: (block: PermissionBlock, behavior: 'allow' | 'deny', message?: string) => Promise<void>; signer: ApprovalSigner } {
  const signer = useApprovalSigner();
  const resolve = useResolveChatPermission(chatId, streamKey, {});
  const answer = useCallback(
    async (block: PermissionBlock, behavior: 'allow' | 'deny', message?: string): Promise<void> => {
      const risky = permissionRisk(block) === 'risky';
      try {
        const approvalProof = risky
          ? await signer.sign({ gate: { kind: 'tool_permission', id: block.interactionId, entityId: chatId }, decision: behavior }, approvalPrompt(behavior, permissionView(block).code))
          : undefined;
        await resolve.mutateAsync({ interactionId: block.interactionId, behavior, ...(message ? { message } : {}), ...(approvalProof ? { approvalProof } : {}) });
        // Success haptics fire on the server's confirmation (MD-78).
        haptic(behavior === 'allow' ? 'success' : 'warning');
      } catch (error) {
        if ((error as { cancelled?: boolean }).cancelled) throw error;
        // 409: another device answered first; the stream settles the card.
        if (error instanceof ApiError && error.status === 409) return;
        const rejection = approvalRejection(error);
        if (rejection === 'key-missing' || rejection === 'proof-required') {
          signer.refresh();
          toast({ kind: 'error', message: 'Register the approval key on this device to answer risky requests.' });
        } else if (rejection === 'proof-invalid') {
          toast({ kind: 'error', message: "The server couldn't verify that approval. Try again." });
        } else {
          haptic('error');
          toast({ kind: 'error', message: risky && !(error instanceof ApiError) ? "Couldn't sign that answer on this device." : "Couldn't send that decision. Try again." });
        }
        throw error;
      }
    },
    [signer, chatId, resolve],
  );
  return { answer, signer };
}

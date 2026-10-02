// MB-15 / MB-50 data: the signed-approval state of this device for the active server (MG-05, MD-31). Readiness is
// the native key's status (ok / missing / invalidated / unsupported, or `unavailable` on an app built before
// M6-03); `register` creates and registers the key (one prompt); `sign` signs one answer (one prompt, no cache).
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApprovalProof } from '@generatorai/shared';

import { useApi } from '../../services/api/useApi';
import { useAuth } from '../../services/auth/AuthProvider';
import { approvalReadiness, registerApprovalKey, signApproval, type ApprovalApi, type ApprovalContext, type ApprovalTarget } from '../../services/auth/approvalSigning';
import { approvalErrorCode, type ApprovalPrompt } from '../../services/native/approvalKey';
import { nouns } from '../../ui/platform/nouns';
import { haptic } from '../../ui/platform/haptics';
import { toast } from '../../ui/primitives/Toast';
import { approvalFailureNote, type ApprovalReadiness } from './model/gateModel';

export interface ApprovalSigner {
  readiness: ApprovalReadiness;
  noun: string;
  register: () => void;
  registering: boolean;
  /** The last prompt's outcome when it produced no signature (timeout, cancel, unsupported …); cleared on retry. */
  error: string | null;
  /** Signs one answer; rejects with `{ cancelled: true }` when the person cancelled the prompt. */
  sign: (target: ApprovalTarget, prompt: ApprovalPrompt) => Promise<ApprovalProof>;
  /** Re-read the key (after a 403 `APPROVAL_KEY_MISSING`). */
  refresh: () => void;
}

const REGISTER_PROMPT: ApprovalPrompt = { title: 'Register approval key', subtitle: 'Lets this device approve risky actions', cancel: 'Cancel' };

export function useApprovalSigner(): ApprovalSigner {
  const api = useApi();
  const { serverId, state } = useAuth();
  const client = useQueryClient();
  const deviceId = state.status === 'authenticated' ? state.deviceId : null;
  const key = useMemo(() => ['approval-key', serverId ?? ''] as const, [serverId]);
  const status = useQuery({ queryKey: key, queryFn: () => approvalReadiness({ serverId: serverId! }), enabled: Boolean(serverId), staleTime: 30_000 });
  const ctx = useMemo<ApprovalContext | null>(() => (serverId && deviceId ? { api: api as unknown as ApprovalApi, serverId, deviceId } : null), [api, serverId, deviceId]);
  const refresh = useCallback(() => void client.invalidateQueries({ queryKey: key }), [client, key]);
  const noun = nouns().biometric;
  const [error, setError] = useState<string | null>(null);
  const register = useMutation({
    mutationFn: async () => {
      if (!ctx) throw new Error('Not paired');
      await registerApprovalKey(ctx, REGISTER_PROMPT);
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      haptic('success');
      refresh();
    },
    // Every outcome is visible (M6 device review): the card returns to "Register approval key" with the reason.
    onError: (failure) => {
      const code = approvalErrorCode(failure);
      const note = approvalFailureNote(code, 'register', noun);
      setError(note);
      if (code !== 'cancelled') {
        haptic('error');
        toast({ kind: 'error', message: note });
      }
      refresh();
    },
  });
  const sign = useCallback(
    async (target: ApprovalTarget, prompt: ApprovalPrompt) => {
      if (!ctx) throw new Error('Not paired');
      setError(null);
      try {
        return await signApproval(ctx, target, prompt);
      } catch (failure) {
        const code = approvalErrorCode(failure);
        if (code !== 'failed') refresh();
        setError(approvalFailureNote(code, 'sign', noun));
        throw Object.assign(failure instanceof Error ? failure : new Error(String(failure)), { cancelled: code === 'cancelled', approvalCode: code });
      }
    },
    [ctx, refresh, noun],
  );
  const readiness: ApprovalReadiness = !serverId || status.isLoading ? 'checking' : (status.data ?? 'checking');
  return { readiness, noun, register: () => register.mutate(), registering: register.isPending, error, sign, refresh };
}

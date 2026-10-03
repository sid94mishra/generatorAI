// Settings writes from a phone (MD-30, 06 §6.4): a control whose write needs a scope the device lacks shows
// "Requires admin access · Request" (→ the scope request sheet pre-filled with that scope); once granted, every
// write runs behind a biometric step-up that never caches, and a device with no passcode is refused.
import { useCallback } from 'react';
import { router } from 'expo-router';

import { scopeRequestHref } from '../../blocks/shell/hrefs';
import { requireWriteStepUp } from '../../services/auth/stepUp';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { errorText } from '../../ui/lib/format';
import { toast } from '../../ui/primitives/Toast';

type Href = Parameters<typeof router.push>[0];

export interface ScopeAccess {
  granted: boolean;
  /** Opens the scope request sheet for this scope. */
  request: () => void;
}

export function useScopeAccess(scope: string, reason?: string): ScopeAccess {
  const granted = useGrantedScopes().includes(scope);
  const request = useCallback(() => router.push(scopeRequestHref([scope], reason) as Href), [scope, reason]);
  return { granted, request };
}

export const NO_PASSCODE_MESSAGE = 'Set a passcode on this device to change server settings.';

/**
 * Runs one admin write after a fresh step-up. Resolves the write's result, or `undefined` when the person cancelled,
 * the device has no passcode, or the write failed (each failure is an error toast, MD-26).
 */
export async function adminWrite<T>(reason: string, write: () => Promise<T>): Promise<T | undefined> {
  const step = await requireWriteStepUp(reason);
  if (step === 'no-passcode') {
    toast({ kind: 'error', message: NO_PASSCODE_MESSAGE });
    return undefined;
  }
  if (step !== 'ok') return undefined;
  try {
    return await write();
  } catch (e) {
    toast({ kind: 'error', message: errorText(e) });
    return undefined;
  }
}

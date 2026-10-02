// The device's granted scopes and the workspace capability checks as hooks (rules: ./capabilities).
import { useMemo } from 'react';

import { useAuth } from './AuthProvider';
import { checkCapability, type CapabilityCheck, type WorkbenchCapability } from './capabilities';

const NONE: readonly string[] = [];

/** The scopes this device's token carries, as a stable array. */
export function useGrantedScopes(): readonly string[] {
  const { state } = useAuth();
  return state.status === 'authenticated' ? state.scopes : NONE;
}

export function useCapability(capability: WorkbenchCapability): CapabilityCheck {
  const scopes = useGrantedScopes();
  return useMemo(() => checkCapability(capability, scopes), [capability, scopes]);
}

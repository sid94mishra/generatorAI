// The scopes this device's token carries, as a stable array.

import { useMemo } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { checkCapability, type CapabilityCheck, type WorkbenchCapability } from './scopes';

const NONE: readonly string[] = [];

export function useGrantedScopes(): readonly string[] {
  const { state } = useAuth();
  return state.status === 'authenticated' ? state.scopes : NONE;
}

export function useCapability(capability: WorkbenchCapability): CapabilityCheck {
  const scopes = useGrantedScopes();
  return useMemo(() => checkCapability(capability, scopes), [capability, scopes]);
}

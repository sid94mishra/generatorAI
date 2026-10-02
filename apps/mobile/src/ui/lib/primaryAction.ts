// The PrimaryActionRegistry (03 ML-01; MP-04 rule; MD-22): a screen has at most one ink-filled button. Screen provides
// the registry; a primary Button registers while mounted; a second one logs a dev warning. No-op outside a Screen.
import { createContext, useContext, useEffect } from 'react';

export interface PrimaryActionRegistry {
  register: (label: string) => () => void;
}

export const PrimaryActionContext = createContext<PrimaryActionRegistry | null>(null);

export function createPrimaryRegistry(warn: (message: string) => void): PrimaryActionRegistry {
  const live = new Map<number, string>();
  let next = 0;
  return {
    register(label) {
      const id = next++;
      live.set(id, label);
      if (live.size > 1) warn(`[Screen] more than one primary button: ${[...live.values()].join(', ')} (MD-22).`);
      return () => void live.delete(id);
    },
  };
}

export function useRegisterPrimary(active: boolean, label: string): void {
  const registry = useContext(PrimaryActionContext);
  useEffect(() => (registry && active ? registry.register(label) : undefined), [registry, active, label]);
}

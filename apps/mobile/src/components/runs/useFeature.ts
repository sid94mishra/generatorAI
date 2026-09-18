// ────────────────────────────────────────────────────────────────
// useFeature — a scope-gated capability plus the way to ask for it.
//
// Controls the device cannot use are shown DISABLED with "Request access"
// rather than hidden: hiding them makes the phone look like it simply has no
// such feature, and the user never learns it is one approval away.
// ────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { router } from 'expo-router';

import { useAuth } from '../../auth/AuthProvider';
import { checkFeature, type FeatureAvailability, type MobileFeature } from '../../auth/featureGate';

export function useFeature(feature: MobileFeature): FeatureAvailability & {
  requestAccess: () => void;
  scopes: readonly string[];
} {
  const { state } = useAuth();
  const scopes = state.status === 'authenticated' ? state.scopes : [];
  const check = checkFeature(feature, scopes);

  const firstMissing = check.missing[0];
  const requestAccess = useCallback(() => {
    router.push({
      pathname: '/scope-request',
      params: firstMissing ? { scope: firstMissing } : {},
    } as never);
  }, [firstMissing]);

  return { ...check, requestAccess, scopes };
}

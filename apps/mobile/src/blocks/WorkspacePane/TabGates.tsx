// Gates for the pane's exec tabs (Terminal, Browser, Computer; 03 MB-27…MB-29, MD-30): a device without the scope sees
// why and "Request access" (the scope request sheet with the scope ticked); a user shell asks for the biometric
// step-up first (the existing 10-minute window, `services/auth/stepUp`) — and only while the tab is on screen, so a
// hidden tab never raises Face ID. A declined prompt leaves "Confirm it's you", never a blank tab.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { hasFreshStepUp, requireStepUp } from '../../services/auth/stepUp';
import type { FeatureAvailability } from '../../services/auth/featureGate';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { PermissionState } from '../../ui/primitives/PermissionState';
import { Text } from '../../ui/primitives/Text';
import { scopeRequestHref } from '../shell/hrefs';

export function LockedTab({ title, feature, scope }: { title: string; feature: FeatureAvailability; scope: string }): React.ReactElement {
  return (
    <View className="flex-1 gap-2 p-4" testID="pane-locked">
      <PermissionState kind="scope" status="missing-scope" scope={title} {...(feature.grantable ? { onRequest: () => router.push(scopeRequestHref([scope]) as never) } : {})} />
      {feature.reason ? (
        <Text role="footnote" tone="fg-3" align="center">
          {feature.reason}
        </Text>
      ) : null}
    </View>
  );
}

type Phase = 'checking' | 'confirmed' | 'declined';

export function StepUpTab({ reason, active, children }: { reason: string; active: boolean; children: React.ReactNode }): React.ReactElement {
  const [phase, setPhase] = useState<Phase>(() => (hasFreshStepUp() ? 'confirmed' : 'checking'));
  useEffect(() => {
    if (phase !== 'checking' || !active) return undefined;
    let cancelled = false;
    void requireStepUp(reason).then((ok) => {
      if (!cancelled) setPhase(ok ? 'confirmed' : 'declined');
    });
    return () => {
      cancelled = true;
    };
  }, [phase, active, reason]);
  if (phase === 'confirmed') return <>{children}</>;
  if (phase === 'declined') return <EmptyState icon="lock" title="Confirm it’s you" description={reason} action={{ label: 'Confirm', onPress: () => setPhase('checking') }} />;
  return <View className="flex-1" accessibilityLabel="Confirming it’s you" />;
}

// ────────────────────────────────────────────────────────────────
// LockedPane — a pane this device may not use yet.
//
// HIG: hiding a destination is worse than explaining it. Terminal and
// Browser stay in the strip without their scope; the page says why and
// offers the route to request it.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { LockedState } from '../../ui/States';
import type { FeatureAvailability } from '../../../auth/featureGate';

export function LockedPane({
  title,
  feature,
  scope,
}: {
  title: string;
  feature: FeatureAvailability;
  /** The scope to request, e.g. `exec:terminal`. */
  scope: string;
}): React.ReactElement {
  return (
    <View className="flex-1 justify-center">
      <LockedState
        title={title}
        reason={feature.reason ?? 'This device does not hold the permission this pane needs.'}
        {...(feature.grantable
          ? {
              action: {
                label: 'Request access',
                onPress: () => router.push({ pathname: '/scope-request', params: { scope } } as never),
              },
            }
          : {})}
      />
    </View>
  );
}

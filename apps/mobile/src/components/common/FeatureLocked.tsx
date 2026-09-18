// ────────────────────────────────────────────────────────────────
// Feature-locked placeholder.
//
// Shown INSTEAD of a gated surface, never around it. A screen that opens and
// then fails is indistinguishable from a bug, and "the terminal is broken"
// is the conclusion a user reaches.
//
// The copy explains the reason and, when the capability is actually
// obtainable, says where to obtain it. When it is structurally impossible
// (a phone cannot browse the host filesystem) it says that instead of
// offering a request that would never help.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { ShieldAlert } from 'lucide-react-native';

import type { FeatureAvailability } from '../../auth/featureGate';
import { useTheme } from '../../theme/ThemeProvider';

export function FeatureLocked({
  feature,
  check,
}: {
  feature: string;
  check: FeatureAvailability;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <ShieldAlert size={32} color={colors.warning} />
      <Text className="text-center text-base font-semibold text-foreground">
        {feature} is not available on this device
      </Text>
      <Text className="text-center text-sm text-muted-foreground">{check.reason}</Text>

      {check.grantable ? (
        <View className="rounded-lg border border-border bg-card p-3">
          <Text className="text-center text-sm text-muted-foreground">
            To enable it, open Settings → Security on your desktop, find this device, and grant
            the permission there.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

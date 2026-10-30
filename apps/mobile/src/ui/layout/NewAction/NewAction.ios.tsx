// ML-09 NewAction — iOS (03 ML-09): a Liquid Glass capsule (GlassSurface `new`, interactive), h-new 52, radius 26,
// padding 16 / 20, icon 20 + 16/600 label; collapses to the 52 circle while the list scrolls down. It sits at the end,
// 6 above the safe area (controls.newAction), inside the Screen's bottom accessory slot.
import React from 'react';
import { View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { GlassSurface } from '../../native/GlassSurface';
import { geometry } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { useMotion } from '../../platform/motion';
import { Icon } from '../../primitives/Icon';
import type { IconSize } from '../../primitives/Icon/Icon.types';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { NewActionProps } from './NewAction.types';

export type { NewActionProps } from './NewAction.types';

export function NewAction({ label, icon, onPress, collapsed = false, testID }: NewActionProps): React.ReactElement {
  const insets = useInsets();
  const reveal = useMotion('reveal');
  const g = geometry().controls.newAction;
  return (
    <View className="items-end" style={{ paddingEnd: g.endInset, paddingBottom: insets.bottom + g.bottomAboveSafeArea }}>
      <Pressable testID={testID} onPress={onPress} frame="none" feedback="scale" large accessibilityRole="button" accessibilityLabel={label} className="max-w-full">
        <Animated.View layout={reveal.reduced ? undefined : LinearTransition.duration(220)} className="max-w-full">
          <GlassSurface radiusStep="new" interactive className={cn('min-h-new max-w-full flex-row items-center justify-center gap-2', collapsed ? 'w-13' : 'pe-5 ps-4')}>
            <Icon concept={icon} size={g.icon as IconSize} tone="fg" />
            {collapsed ? null : (
              <Text role="transcript" weight={600} numberOfLines={1} ellipsizeMode="tail" className="shrink">
                {label}
              </Text>
            )}
          </GlassSurface>
        </Animated.View>
      </Pressable>
    </View>
  );
}

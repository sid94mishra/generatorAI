// MP-47 Collapsible (03 MP-47): a pressable header with a chevron and a body that reveals with the `reveal` motion
// (02 §6.2; opacity only under Reduce Motion).
import React, { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { useMotion } from '../../platform/motion';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import type { CollapsibleProps } from './Collapsible.types';

export type { CollapsibleProps } from './Collapsible.types';

export function Collapsible({ expanded, defaultExpanded = false, onExpandedChange, header, children, accessibilityLabel, testID }: CollapsibleProps): React.ReactElement {
  const [own, setOwn] = useState(defaultExpanded);
  const open = expanded ?? own;
  const reveal = useMotion('reveal');
  const fade = reveal.effects?.type === 'timing' ? reveal.effects.config.duration ?? 180 : 180;
  const layout = reveal.reduced
    ? undefined
    : reveal.spatial?.type === 'spring'
      ? LinearTransition.springify().stiffness(reveal.spatial.config.stiffness ?? 322).damping(reveal.spatial.config.damping ?? 36)
      : LinearTransition;
  const toggle = (): void => {
    const next = !open;
    if (expanded === undefined) setOwn(next);
    onExpandedChange?.(next);
  };
  return (
    <Animated.View testID={testID} layout={layout} className="overflow-hidden">
      <Pressable
        onPress={toggle}
        frame="none"
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        className="min-h-item flex-row items-center gap-2"
      >
        <View className="flex-1">{header}</View>
        <Icon concept={open ? 'chevron-up' : 'chevron-down'} size={14} tone="fg-3" />
      </Pressable>
      {open ? (
        <Animated.View entering={FadeIn.duration(fade)} exiting={FadeOut.duration(fade)}>
          {children}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

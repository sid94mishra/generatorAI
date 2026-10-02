// Icon — Jest and react-native-web fallback (Icon.ios.tsx / Icon.android.tsx are the native
// implementations; mobile 02 §5.3). Every concept draws its lucide glyph here.
import React from 'react';
import Animated from 'react-native-reanimated';
import { ICON } from '@generatorai/design-tokens';

import type { IconProps } from './Icon.types';
import { iconA11yProps, useIconColor, useSpinStyle } from './iconSupport';
import { LUCIDE_ALL } from './lucideAll';

export type { IconProps, IconSize, IconTone } from './Icon.types';

export function Icon({ concept, size = 20, tone = 'fg-2', spinning = false, accessibilityLabel, testID }: IconProps): React.ReactElement {
  const color = useIconColor(tone);
  const spin = useSpinStyle(spinning);
  const Glyph = LUCIDE_ALL[concept];
  return (
    <Animated.View testID={testID} style={spin} {...iconA11yProps(accessibilityLabel)}>
      <Glyph size={size} color={color} strokeWidth={ICON.strokeWidth} />
    </Animated.View>
  );
}

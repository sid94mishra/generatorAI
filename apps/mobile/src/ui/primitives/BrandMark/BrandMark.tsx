// MP-52 BrandMark (03 MP-52): the GeneratorAI glyph (the desktop sidebar's bolt on an accent tile) and GitHub's mark
// (source control). Colours come from the theme: the app tile is the accent, the GitHub mark is `fg`. Agent-provider
// logos are ProviderLogo, drawn from the one registry shared with the desktop app (D-132).
import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColors } from '../../lib/themeColors';
import { Icon } from '../Icon';
import type { IconSize } from '../Icon/Icon.types';
import type { BrandMarkKind, BrandMarkProps } from './BrandMark.types';
import { GITHUB_PATH } from './marks';

export type { BrandMarkKind, BrandMarkProps, BrandMarkSize } from './BrandMark.types';

/** The bolt inside the app tile: ~0.58 of the tile, snapped to an icon size. */
function boltSize(size: number): IconSize {
  const target = size * 0.58;
  return ([12, 14, 16, 18, 20, 22, 24] as const).reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best));
}

export function BrandMark({ mark, size = 20, label, testID }: BrandMarkProps): React.ReactElement {
  const colors = useThemeColors();
  const a11y = label
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }
    : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const };
  if (mark === 'app') {
    return (
      <View
        testID={testID}
        {...a11y}
        className="items-center justify-center bg-accent"
        style={{ width: size, height: size, borderRadius: size / 3 }}
      >
        <Icon concept="zap" size={boltSize(size)} tone="on-accent" />
      </View>
    );
  }
  return (
    <View testID={testID} {...a11y}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path fill={colors.fg} d={GITHUB_PATH} />
      </Svg>
    </View>
  );
}

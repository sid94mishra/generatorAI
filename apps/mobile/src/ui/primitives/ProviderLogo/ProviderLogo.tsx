// ProviderLogo (D-132): an agent provider's brand mark, drawn from the ONE registry shared with the desktop app
// (`PROVIDER_LOGOS`, packages/design-tokens/src/provider-logos.ts) with react-native-svg. `color` uses the brand's
// own colour where it has one (Claude's orange) and the theme's `fg` for monochrome brands, so every mark reads on
// every theme; `mono` always draws in `fg`. Owner deviation from MP-52's "never a brand hex in-app" (D-132).
import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { providerLogo } from '@generatorai/design-tokens';

import { useThemeColors } from '../../lib/themeColors';
import type { ProviderLogoProps } from './ProviderLogo.types';

export type { ProviderLogoProps, ProviderLogoSize } from './ProviderLogo.types';

export function ProviderLogo({ provider, size = 20, variant = 'color', label, testID }: ProviderLogoProps): React.ReactElement {
  const colors = useThemeColors();
  const logo = providerLogo(provider);
  const name = label === true ? logo.title : label;
  const a11y = name
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: name }
    : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const };
  const fill = variant === 'color' && logo.brandColor ? logo.brandColor : colors.fg;
  return (
    <View testID={testID} {...a11y}>
      <Svg width={size} height={size} viewBox={logo.viewBox}>
        {logo.paths.map((path) => (
          <Path key={path.d.slice(0, 24)} fill={fill} fillRule={path.fillRule} clipRule={path.fillRule} d={path.d} />
        ))}
      </Svg>
    </View>
  );
}

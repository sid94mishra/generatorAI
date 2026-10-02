// MP-38 GlassSurface — iOS (02 §8.2): expo-glass-effect GlassView, `regular`, interactive for controls, no tint,
// the app's appearance as its colour scheme, the radius from tokens. Falls back to the opaque recipe when useGlass()
// says no (Reduce Transparency, no Liquid Glass, older iOS). Never animate opacity on it or its ancestors.
import React from 'react';
import { View } from 'react-native';
import type * as GlassEffect from 'expo-glass-effect';
import { withUniwind } from 'uniwind';

import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { geometry } from '../../platform/geometry';
import { useGlass } from '../../platform/glass';
import type { GlassGroupProps, GlassRadiusStep, GlassSurfaceProps } from './GlassSurface.types';
import { GLASS_FALLBACK_CLASS, GLASS_RADIUS_CLASS } from './glassModel';

export type { GlassGroupProps, GlassRadiusStep, GlassSurfaceProps } from './GlassSurface.types';

/** expo-glass-effect registers its native views on import, so it is required only where it can load (not in Jest
 * or a client without the module); its views take classes through withUniwind (MD-133). */
const glass: { View: ReturnType<typeof withUniwind<typeof GlassEffect.GlassView>>; Container: ReturnType<typeof withUniwind<typeof GlassEffect.GlassContainer>> } | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-glass-effect') as typeof GlassEffect;
    return { View: withUniwind(mod.GlassView), Container: withUniwind(mod.GlassContainer) };
  } catch {
    return null;
  }
})();

function radiusFor(step: GlassRadiusStep): number {
  return step === 'full' ? 999 : geometry().radii[step];
}

export function GlassSurface({ radiusStep, interactive = false, className, children, testID }: GlassSurfaceProps): React.ReactElement {
  const available = useGlass();
  const { appearance } = useThemeColors();
  if (!available || !glass) {
    return (
      <View testID={testID} className={cn(GLASS_FALLBACK_CLASS, GLASS_RADIUS_CLASS[radiusStep], className)}>
        {children}
      </View>
    );
  }
  return (
    <glass.View
      testID={testID}
      glassEffectStyle="regular"
      isInteractive={interactive}
      colorScheme={appearance}
      className={cn('overflow-hidden', className)}
      style={{ borderRadius: radiusFor(radiusStep) }}
    >
      {children}
    </glass.View>
  );
}

export function GlassGroup({ children, className }: GlassGroupProps): React.ReactElement {
  const available = useGlass();
  if (!available || !glass) return <View className={cn('flex-row gap-2', className)}>{children}</View>;
  return (
    <glass.Container spacing={8} className={cn('flex-row gap-2', className)}>
      {children}
    </glass.Container>
  );
}

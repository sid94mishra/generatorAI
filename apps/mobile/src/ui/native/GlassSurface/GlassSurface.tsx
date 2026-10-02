// MP-38 GlassSurface — the opaque fallback (Android, web, Jest; 02 §8.2): bg-overlay + 1px line + shadow-float with
// the step's radius. iOS draws Liquid Glass in GlassSurface.ios.tsx when useGlass() allows it.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import type { GlassGroupProps, GlassSurfaceProps } from './GlassSurface.types';
import { GLASS_FALLBACK_CLASS, GLASS_RADIUS_CLASS } from './glassModel';

export type { GlassGroupProps, GlassRadiusStep, GlassSurfaceProps } from './GlassSurface.types';

export function GlassSurface({ radiusStep, className, children, testID }: GlassSurfaceProps): React.ReactElement {
  return (
    <View testID={testID} className={cn(GLASS_FALLBACK_CLASS, GLASS_RADIUS_CLASS[radiusStep], className)}>
      {children}
    </View>
  );
}

/** Neighbouring glass pieces that should merge (iOS GlassContainer, spacing 8); a plain row elsewhere. */
export function GlassGroup({ children, className }: GlassGroupProps): React.ReactElement {
  return <View className={cn('flex-row gap-2', className)}>{children}</View>;
}

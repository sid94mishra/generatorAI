// MP-05 IconButton (03 MP-05): a drawn circle (44/48 md, 36/40 sm) inside a hit-target frame (MD-91), with an
// optional count bubble or dot. Android filled (Send / Stop) is the 48 square with radius 16 (MD-56).
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { GlassSurface } from '../../native/GlassSurface';
import { geometry, nativePlatform } from '../../platform/geometry';
import { Count } from '../Count';
import { Icon } from '../Icon';
import type { IconSize } from '../Icon/Icon.types';
import { Pressable } from '../Pressable';
import type { IconButtonProps } from './IconButton.types';
import { BADGE_POSITION, iconButtonSurface } from './iconButtonStyles';

export type { IconButtonProps, IconButtonVariant } from './IconButton.types';

/** Glyph size: header glyph (22 / 24) at md; 18 / 20 inside the sm circle (MD-127). */
export function iconButtonGlyph(size: 'sm' | 'md'): IconSize {
  if (size === 'md') return geometry().controls.header.toolbarGlyph as IconSize;
  return nativePlatform === 'android' ? 20 : 18;
}

/** The drawn circle: Liquid Glass on iOS for `glass` (GlassSurface, interactive), a plain view otherwise. */
function Surface({ glass, className, children }: { glass: boolean; className: string; children: React.ReactNode }): React.ReactElement {
  if (glass && nativePlatform === 'ios') {
    return (
      <GlassSurface radiusStep="full" interactive className={className}>
        {children}
      </GlassSurface>
    );
  }
  return <View className={className}>{children}</View>;
}

export function IconButton({
  icon,
  label,
  variant = 'plain',
  size = 'md',
  selected = false,
  badge,
  filled = false,
  disabled = false,
  onPress,
  onLongPress,
  haptic,
  testID,
}: IconButtonProps): React.ReactElement {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      feedback="scale"
      borderless
      haptic={haptic}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <Surface glass={variant === 'glass'} className={cn(iconButtonSurface({ variant, size, selected }))}>
        <View className={disabled ? 'opacity-40' : undefined}>
          <Icon concept={icon} size={iconButtonGlyph(size)} tone={variant === 'filled' ? 'on-accent' : 'fg'} filled={filled} />
        </View>
        {badge?.count !== undefined || badge?.dot ? (
          <View className={BADGE_POSITION}>
            {badge.count !== undefined ? (
              <Count value={badge.count} form="bubble" tone={badge.tone === 'run' ? 'run' : 'fg-3'} max={99} hidden />
            ) : (
              <Count value={1} form="dot" hidden />
            )}
          </View>
        ) : null}
      </Surface>
    </Pressable>
  );
}

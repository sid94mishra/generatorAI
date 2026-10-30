// Icon — iOS: SF Symbols through expo-symbols (mobile 02 §5.3 rule 1). lucideOnly concepts, and every
// concept while the client has no SymbolModule (a dev client built before M3-07), draw the lucide glyph.
import React from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { requireOptionalNativeModule } from 'expo';
import type { SymbolViewProps } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import { GEOMETRY, ICON, mobileIconDef, type ICON_CONCEPTS, type MOBILE_ICON_CONCEPTS } from '@generatorai/design-tokens';

import type { IconProps } from './Icon.types';
import { iconA11yProps, useIconColor, useSpinStyle } from './iconSupport';
import { LUCIDE_ALL } from './lucideAll';

export type { IconProps, IconSize, IconTone } from './Icon.types';

/** Every concept the kit draws: the shared registry plus the mobile-only entries. */
type AllConcepts = typeof ICON_CONCEPTS & typeof MOBILE_ICON_CONCEPTS;

// Compile-time check that every registry SF name exists in the SF Symbols catalogue (sf-symbols-typescript).
type RegistrySf = { [K in keyof AllConcepts]: AllConcepts[K] extends { sfSymbol: infer S } ? S : never }[keyof AllConcepts];
type RegistrySfFill = { [K in keyof AllConcepts]: AllConcepts[K] extends { sfSymbolFill: infer S } ? S : never }[keyof AllConcepts];
type AssertSf<T extends SFSymbol> = T;
export type RegistrySfNames = AssertSf<RegistrySf | RegistrySfFill>;

/** expo-symbols, loaded only when the native module is in this build (no red box on an older dev client). */
const SymbolView: React.ComponentType<SymbolViewProps> | null = requireOptionalNativeModule('SymbolModule')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-symbols') as { SymbolView: React.ComponentType<SymbolViewProps> }).SymbolView
  : null;

export function Icon({
  concept,
  size = GEOMETRY.ios.icon.row as IconProps['size'] & number,
  tone = 'fg-2',
  filled = false,
  spinning = false,
  accessibilityLabel,
  testID,
}: IconProps): React.ReactElement {
  const color = useIconColor(tone);
  const spin = useSpinStyle(spinning);
  const def = mobileIconDef(concept);
  const Lucide = LUCIDE_ALL[concept];
  const lucide = <Lucide size={size} color={color} strokeWidth={ICON.strokeWidth} />;
  let glyph = lucide;
  if (SymbolView && !def.lucideOnly && def.sfSymbol) {
    const name = (filled && def.sfSymbolFill ? def.sfSymbolFill : def.sfSymbol) as SFSymbol;
    glyph = (
      <SymbolView
        name={name}
        size={size}
        type="monochrome"
        weight="regular"
        tintColor={color}
        animationSpec={concept === 'status-needs-you' && !spin ? { effect: { type: 'bounce' }, repeatCount: 1 } : undefined}
        // A misspelt SF name shows as a red square in development (Storybook "All concepts"); release draws lucide.
        fallback={__DEV__ ? <View className="bg-err" style={{ width: size, height: size }} /> : lucide}
      />
    );
  }
  return (
    <Animated.View testID={testID} style={spin} {...iconA11yProps(accessibilityLabel)}>
      {glyph}
    </Animated.View>
  );
}

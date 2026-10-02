// Icon — Android: Material Symbols (outlined, weight 400) through expo-symbols, whose Android view is
// JS + the font it loads with expo-font (no native module); filled states from the generated SVGs
// (expo#46850); lucideOnly concepts from lucide (mobile 02 §5.3 rules 2 and 4).
import React from 'react';
import { I18nManager } from 'react-native';
import Animated from 'react-native-reanimated';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { GEOMETRY, ICON, mobileIconDef, type ICON_CONCEPTS, type MOBILE_ICON_CONCEPTS } from '@generatorai/design-tokens';

import type { IconProps } from './Icon.types';
import { iconA11yProps, useIconColor, useSpinStyle } from './iconSupport';
import { LUCIDE_ONLY } from './lucide';
import { MATERIAL_FILLED } from './material-filled';

export type { IconProps, IconSize, IconTone } from './Icon.types';

/** expo-symbols' Material name union. */
type AndroidSymbol = NonNullable<Exclude<SymbolViewProps['name'], string>['android']>;

/** Every concept the kit draws: the shared registry plus the mobile-only entries. */
type AllConcepts = typeof ICON_CONCEPTS & typeof MOBILE_ICON_CONCEPTS;

// Compile-time check that every registry Material name is one expo-symbols can draw.
type RegistryMaterial = { [K in keyof AllConcepts]: AllConcepts[K] extends { material: infer S } ? S : never }[keyof AllConcepts];
type AssertMaterial<T extends AndroidSymbol> = T;
export type RegistryMaterialNames = AssertMaterial<RegistryMaterial>;

export function Icon({
  concept,
  size = GEOMETRY.android.icon.row as IconProps['size'] & number,
  tone = 'fg-2',
  filled = false,
  spinning = false,
  accessibilityLabel,
  testID,
}: IconProps): React.ReactElement {
  const color = useIconColor(tone);
  const spin = useSpinStyle(spinning);
  const def = mobileIconDef(concept);
  let glyph: React.ReactElement;
  if (def.lucideOnly) {
    const Lucide = LUCIDE_ONLY[concept as keyof typeof LUCIDE_ONLY];
    glyph = <Lucide size={size} color={color} strokeWidth={ICON.strokeWidth} />;
  } else {
    const Filled = filled && def.materialFill ? MATERIAL_FILLED[def.material as string] : undefined;
    glyph = Filled ? (
      <Filled size={size} color={color} />
    ) : (
      <SymbolView name={{ android: def.material as AndroidSymbol }} size={size} tintColor={color} />
    );
  }
  const mirror = def.mirrorInRtl && I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined;
  return (
    <Animated.View testID={testID} style={[mirror, spin]} {...iconA11yProps(accessibilityLabel)}>
      {glyph}
    </Animated.View>
  );
}

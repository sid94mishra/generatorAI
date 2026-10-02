// Font scale and per-role caps (mobile 02 §4.1): content scales fully, a role's `maxScale` caps it,
// and dense chrome caps at `chromeScaleCap`. A story-only override renders a role at a simulated scale
// (the `withFontScale` story decorator), since the OS text size cannot be set per view.
import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';
import type { MobileTextStep, TextStep } from '@generatorai/design-tokens';
import { geometry } from './geometry';

export function useFontScale(): number {
  return useWindowDimensions().fontScale;
}

/** maxFontSizeMultiplier for a step: the role cap, tightened to chromeScaleCap for chrome; 0 = uncapped. */
export function maxScaleFor(step: TextStep | MobileTextStep, chrome = false): number {
  const g = geometry();
  const role = g.type[step].maxScale;
  if (!chrome) return role;
  return role === 0 ? g.chromeScaleCap : Math.min(role, g.chromeScaleCap);
}

/** The scale a capped step actually renders at for an OS font scale. */
export function effectiveScale(fontScale: number, cap: number): number {
  return cap === 0 ? fontScale : Math.min(fontScale, cap);
}

/** Story-only simulated OS font scale (null in the app). */
export const FontScaleOverrideContext = createContext<number | null>(null);
export const useFontScaleOverride = (): number | null => useContext(FontScaleOverrideContext);

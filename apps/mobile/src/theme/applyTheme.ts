// ────────────────────────────────────────────────────────────────
// Apply the app-wide theme to Uniwind (mobile 02 §9.5 steps 4–7).
//
// One function for prepaint (module evaluation, before any render) and for
// every app ThemeProvider change, so the first frame and the live app agree.
//   1. accent vars first, then setTheme: the switch paints with the right
//      accent, and Uniwind keeps per-theme overrides, so the accent is
//      written every time — also when it is the theme default;
//   2. RN Appearance after: Uniwind.setTheme(<custom theme>) resets the
//      native colour scheme to "unspecified" (MD-119);
//   3. the literal colours are published for useThemeColors()/getThemeColors().
// ────────────────────────────────────────────────────────────────

import { Appearance as RNAppearance } from 'react-native';
import { Uniwind, type ThemeName } from 'uniwind';
import { toAccentVars, uniwindThemeName, type Appearance, type ThemeMode } from '@generatorai/design-tokens';

import { publishThemeColors } from '../ui/lib/themeColors';
import type { ResolvedTheme } from './themeState';

export interface AppliedTheme {
  themeId: string;
  mode: ThemeMode;
  appearance: Appearance;
  resolved: ResolvedTheme;
}

export function applyTheme({ themeId, mode, appearance, resolved }: AppliedTheme): void {
  // Every name is in UNIWIND_THEMES (generated with uniwind-themes.json, which Metro registers).
  const name = uniwindThemeName(themeId, appearance) as ThemeName;
  Uniwind.updateCSSVariables(name, { ...toAccentVars(resolved.triple) });
  Uniwind.setTheme(name);
  // iOS/Android only: react-native-web has no native chrome to tint.
  if (typeof RNAppearance.setColorScheme === 'function') {
    RNAppearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }
  publishThemeColors(resolved.colors);
}

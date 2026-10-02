// ────────────────────────────────────────────────────────────────
// Apply the app-wide theme to Uniwind (mobile 02 §9.5 steps 4–6).
//
// One function for prepaint (module evaluation, before any render) and for
// every ThemeProvider change, so the first frame and the live app agree.
//   1. accent vars first, then setTheme: the switch paints with the right
//      accent, and Uniwind keeps per-theme overrides, so the accent is
//      written every time — also when it is the theme default;
//   2. RN Appearance last: Uniwind.setTheme(<custom theme>) resets the
//      native colour scheme to "unspecified", and native chrome (alerts,
//      menus, keyboard, status bar) must follow the app's mode instead.
// ────────────────────────────────────────────────────────────────

import { Appearance as RNAppearance } from 'react-native';
import { Uniwind, type ThemeName } from 'uniwind';
import {
  accentVars,
  getThemeDef,
  uniwindThemeName,
  type AccentId,
  type Appearance,
  type ThemeMode,
} from '@generatorai/design-tokens';

export interface AppliedTheme {
  themeId: string;
  mode: ThemeMode;
  appearance: Appearance;
  accent: AccentId;
}

export function applyTheme({ themeId, mode, appearance, accent }: AppliedTheme): void {
  const theme = getThemeDef(themeId);
  // Every name is in UNIWIND_THEMES (generated with uniwind-themes.json, which Metro registers).
  const name = uniwindThemeName(theme.id, appearance) as ThemeName;
  Uniwind.updateCSSVariables(name, { ...accentVars(theme, appearance, accent) });
  Uniwind.setTheme(name);
  // iOS/Android only: react-native-web has no native chrome to tint.
  if (typeof RNAppearance.setColorScheme === 'function') {
    RNAppearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }
}

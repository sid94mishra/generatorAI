// Toolbar globals → the `applyAppearance` input. Unknown values fall back to
// the app defaults, so a stale URL (`?globals=theme:removed`) still themes.

import {
  ACCENT_IDS,
  DEFAULT_ACCENT,
  DEFAULT_DENSITY,
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME,
  isKnownDensity,
  isKnownFontSize,
  isKnownTheme,
  type AccentId,
} from '@generatorai/design-tokens';
import type { AppliedAppearance } from '../src/ui/lib/appearance';

export function appearanceFromGlobals(globals: Record<string, unknown>): AppliedAppearance {
  const str = (key: string): string | null => {
    const v = globals[key];
    return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
  };
  const accent = str('accent');
  const density = str('density');
  const fontSize = str('fontSize');
  const theme = str('theme');
  const resolved = str('mode') === 'light' ? 'light' : 'dark';
  return {
    mode: resolved,
    resolved,
    theme: isKnownTheme(theme) ? (theme as string) : DEFAULT_THEME,
    accent: (ACCENT_IDS as readonly string[]).includes(accent ?? '') ? (accent as AccentId) : DEFAULT_ACCENT,
    density: isKnownDensity(density) ? density : DEFAULT_DENSITY,
    fontSize: isKnownFontSize(fontSize) ? fontSize : DEFAULT_FONT_SIZE,
    reduceMotion: str('reduceMotion') === 'on',
  };
}

// ────────────────────────────────────────────────────────────────
// Prepaint (mobile 02 §9.5): applies the stored theme at module evaluation,
// before React renders, so the first frame is already themed. Imported by
// app/_layout.tsx right after global.css (whose module registers the Uniwind
// themes). MMKV reads are synchronous, and the System accent comes from the
// cached Material You seeds (02 §2.5), so there is no native read here.
// ────────────────────────────────────────────────────────────────

import { Appearance as RNAppearance } from 'react-native';
import { readStoredAppearance, resolveAppearance } from '@generatorai/design-tokens';

import { prefs } from '../services/storage/prefs';
import { applyTheme } from './applyTheme';
import { readCachedSeeds, readStoredAccentChoice, resolveTheme } from './themeState';

const stored = readStoredAppearance((key) => prefs.getString(key) ?? null);
try {
  const appearance = resolveAppearance(stored.mode, RNAppearance.getColorScheme() !== 'light');
  const accent = readStoredAccentChoice(stored.theme);
  applyTheme({
    themeId: stored.theme,
    mode: stored.mode,
    appearance,
    resolved: resolveTheme(stored.theme, appearance, accent, readCachedSeeds()),
  });
} catch (error) {
  // ThemeProvider applies the same theme on mount; a failed prepaint costs one unthemed frame, not the app.
  if (__DEV__) console.warn('[theme] prepaint failed', error);
}

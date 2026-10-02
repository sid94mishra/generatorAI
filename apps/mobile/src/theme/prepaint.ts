// ────────────────────────────────────────────────────────────────
// Prepaint (mobile 02 §9.5): applies the stored theme at module evaluation,
// before React renders, so the first frame is already themed. Imported by
// app/_layout.tsx right after global.css (whose module registers the Uniwind
// themes). MMKV reads are synchronous; the splash stays up until the shell
// has painted (app/_layout.tsx).
// ────────────────────────────────────────────────────────────────

import { Appearance as RNAppearance } from 'react-native';
import { readStoredAppearance, resolveAppearance } from '@generatorai/design-tokens';

import { prefs } from '../services/storage/prefs';
import { applyTheme } from './applyTheme';

const stored = readStoredAppearance((key) => prefs.getString(key) ?? null);
try {
  applyTheme({
    themeId: stored.theme,
    mode: stored.mode,
    appearance: resolveAppearance(stored.mode, RNAppearance.getColorScheme() !== 'light'),
    accent: stored.accent,
  });
} catch (error) {
  // ThemeProvider applies the same theme on mount; a failed prepaint costs one unthemed frame, not the app.
  if (__DEV__) console.warn('[theme] prepaint failed', error);
}

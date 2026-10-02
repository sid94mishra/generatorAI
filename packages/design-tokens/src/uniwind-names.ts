// ────────────────────────────────────────────────────────────────
// Uniwind theme names (mobile 02 §9.2). Runtime-safe (no Node imports), so the
// mobile app's prepaint and ThemeProvider read the same names the generator
// (emit/uniwind.ts) writes into uniwind-themes.css / .json.
// ────────────────────────────────────────────────────────────────

import { THEMES } from './themes/index.js';
import type { Appearance } from './themes/types.js';

/** `${theme.id}-${appearance}`: the Uniwind theme name of one theme × appearance. */
export function uniwindThemeName(themeId: string, appearance: Appearance): string {
  return `${themeId}-${appearance}`;
}

/** `${theme.id}-${appearance}` for every theme in THEMES order, dark then light (36 names). */
export const UNIWIND_THEMES: readonly string[] = THEMES.flatMap((t) =>
  (['dark', 'light'] as const).map((a) => uniwindThemeName(t.id, a)),
);

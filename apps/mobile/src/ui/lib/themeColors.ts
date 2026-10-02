// ────────────────────────────────────────────────────────────────
// useThemeColors() — literal colours for native hosts (mobile 02 §2.6).
//
// Classes cover every RN view; a literal is needed only where a value leaves
// the Uniwind style system (SF/Material glyph tints, Expo UI hosts, status
// bar, xterm, SVG, widgets). Values come from the active theme's generated
// palette module (src/theme/palettes, one theme evaluated at a time) with the
// accent triple overlaid: a named accent, or the Android System accent.
//
// Only src/ui/**, src/services/** and src/theme/** may read it (lint
// `themeColorsInFeature`); features and blocks use classes.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext, useSyncExternalStore } from 'react';
import type {
  AccentTokenTriple,
  Appearance,
  ChartRamp,
  DesignTokens,
  NativeThemePalette,
  SyntaxTokens,
  TerminalPalette,
} from '@generatorai/design-tokens';

export interface ThemeColors extends DesignTokens {
  chart: ChartRamp;
  canvasBg: string;
  canvasDot: string;
  /** xterm ITheme. */
  terminal: TerminalPalette;
  /** Diff / file highlighting (MD-39). */
  syntax: SyntaxTokens;
  appearance: Appearance;
}

/** Palette × appearance with the accent triple overlaid (accent, on-accent, focus only). */
export function resolveThemeColors(palette: NativeThemePalette, appearance: Appearance, accent: AccentTokenTriple): ThemeColors {
  const p = palette[appearance];
  return {
    ...p.tokens,
    accent: accent.accent,
    onAccent: accent.onAccent,
    focus: accent.focus,
    chart: p.chart,
    canvasBg: p.canvasBg,
    canvasDot: p.canvasDot,
    terminal: p.terminal,
    syntax: p.syntax,
    appearance,
  };
}

/** A preview ThemeProvider scopes its own colours; the app provider publishes to the store below. */
export const ThemeColorsContext = createContext<ThemeColors | null>(null);

let current: ThemeColors | null = null;
const listeners = new Set<(c: ThemeColors) => void>();

/** Called by the app ThemeProvider on every change (and by prepaint). */
export function publishThemeColors(colors: ThemeColors): void {
  if (current === colors) return;
  current = colors;
  for (const listener of listeners) listener(colors);
}

/** Same object outside React (effects, native-module calls, notification builders). */
export function getThemeColors(): ThemeColors {
  if (!current) throw new Error('getThemeColors() before the theme was applied (prepaint publishes it)');
  return current;
}

/** Subscribe outside React; returns unsubscribe. */
export function subscribeThemeColors(listener: (c: ThemeColors) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const subscribe = (onChange: () => void): (() => void) => subscribeThemeColors(onChange);

/** Literals for the active theme × appearance × accent. Re-renders on change only. */
export function useThemeColors(): ThemeColors {
  const scoped = useContext(ThemeColorsContext);
  const global = useSyncExternalStore(subscribe, () => current, () => current);
  const colors = scoped ?? global;
  if (!colors) throw new Error('useThemeColors() outside a ThemeProvider');
  return colors;
}

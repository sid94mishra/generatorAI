// ────────────────────────────────────────────────────────────────
// Literal colours for the mobile app's native hosts (mobile 02 §2.6, §9.3).
//
// One palette per theme: the design tokens at the theme's default accent,
// chart / canvas / terminal / syntax colours for both appearances, and the
// accent triples (accent, on-accent, focus) of all seven named accents — the
// deltas `useThemeColors()` overlays, never a full bag per accent. The
// generator writes one module per theme (emit/uniwind.ts → apps/mobile/src/
// theme/palettes/<id>.ts) so the app evaluates only the active theme's.
// Runtime-safe: no Node imports.
// ────────────────────────────────────────────────────────────────

import { accentTokens, type AccentTokenTriple } from './accent.js';
import { resolveDesignTokens, type DesignTokens } from './design.js';
import {
  ACCENT_IDS,
  resolveAppearanceTokens,
  resolveChartRamp,
  resolveSyntaxTokens,
  resolveTerminalPalette,
  type AccentId,
  type Appearance,
  type SyntaxTokens,
  type TerminalPalette,
  type ThemeDef,
} from './themes/types.js';

export type ChartRamp = readonly [string, string, string, string, string, string];

export interface NativeAppearancePalette {
  /** The 32 design tokens at the theme's default accent. */
  tokens: DesignTokens;
  chart: ChartRamp;
  canvasBg: string;
  canvasDot: string;
  terminal: TerminalPalette;
  syntax: SyntaxTokens;
}

export interface NativeThemePalette {
  id: string;
  dark: NativeAppearancePalette;
  light: NativeAppearancePalette;
  accents: Record<Appearance, Record<AccentId, AccentTokenTriple>>;
}

function appearancePalette(theme: ThemeDef, appearance: Appearance): NativeAppearancePalette {
  const t = resolveAppearanceTokens(theme, appearance);
  return {
    tokens: resolveDesignTokens(theme, appearance, theme.defaultAccent),
    chart: resolveChartRamp(theme, appearance) as unknown as ChartRamp,
    canvasBg: t.canvasBg,
    canvasDot: t.canvasDot,
    terminal: resolveTerminalPalette(theme, appearance),
    syntax: resolveSyntaxTokens(theme, appearance),
  };
}

const accentsFor = (theme: ThemeDef, appearance: Appearance): Record<AccentId, AccentTokenTriple> =>
  Object.fromEntries(ACCENT_IDS.map((id) => [id, accentTokens(theme, appearance, id)])) as Record<AccentId, AccentTokenTriple>;

export function buildNativePalette(theme: ThemeDef): NativeThemePalette {
  return {
    id: theme.id,
    dark: appearancePalette(theme, 'dark'),
    light: appearancePalette(theme, 'light'),
    accents: { dark: accentsFor(theme, 'dark'), light: accentsFor(theme, 'light') },
  };
}

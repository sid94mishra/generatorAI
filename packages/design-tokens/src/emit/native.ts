// ────────────────────────────────────────────────────────────────
// The flat token set of one (theme, appearance, accent), keyed by CSS
// variable name — the shape of web's Layer 1, legacy + design layers.
//
// The Uniwind emitter reads its colour blocks from it (emit/uniwind.ts).
// The NativeWind-era token module (themeVars, terminalThemes, themeMeta,
// tailwindColors) it used to feed was removed in M3-08 (mobile 02 §9.6):
// the app reads uniwind-themes.css and the per-theme palettes instead.
// ────────────────────────────────────────────────────────────────

import { DESIGN_COLOR_VARS, resolveDesignTokens } from '../design.js';
import { FILE_ICON_COLORS } from '../tokens.js';
import { THEMES } from '../themes/index.js';
import {
  ACCENT_IDS,
  resolveAccentTokens,
  resolveAppearanceTokens,
  resolveChartRamp,
  type Appearance,
} from '../themes/types.js';

/** camelCase token key → kebab-case CSS variable name. */
const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export interface ResolvedTokenSet {
  [cssVarName: string]: string;
}

/**
 * Every token for one (theme, appearance, accent), keyed by CSS variable name
 * so the shape is identical to the web's Layer 1.
 */
export function resolveTokenSet(
  themeId: string,
  appearance: Appearance,
  accentId: string,
): ResolvedTokenSet {
  const theme = THEMES.find((t) => t.id === themeId);
  if (!theme) throw new Error(`Unknown theme: ${themeId}`);

  const t = resolveAppearanceTokens(theme, appearance);
  const resolvedAccent = (ACCENT_IDS as readonly string[]).includes(accentId)
    ? (accentId as (typeof ACCENT_IDS)[number])
    : theme.defaultAccent;
  const a = resolveAccentTokens(theme, resolvedAccent, appearance);
  const out: ResolvedTokenSet = {};

  for (const [key, value] of Object.entries(t)) {
    out[`--${kebab(key)}`] = value;
  }
  out['--primary'] = a.primary;
  out['--primary-emphasis'] = a.primaryEmphasis;
  out['--ring'] = a.ring;
  out['--accent'] = a.accent;
  out['--sidebar-accent'] = a.sidebarAccent;
  out['--sidebar-accent-foreground'] = a.sidebarAccentForeground;
  // Text on the accent fill: identical to the appearance value for the six hue
  // accents, the surface colour for ink (02 §4.2).
  out['--primary-foreground'] = a.onAccent;

  resolveChartRamp(theme, appearance).forEach((colour, i) => {
    out[`--chart-${i + 1}`] = colour;
  });

  for (const [name, pair] of Object.entries(FILE_ICON_COLORS)) {
    out[`--file-icon-${name}`] = pair[appearance];
  }

  // Design layer (M-01), additive: literal values, translucent ones as
  // #rrggbbaa (React Native accepts both).
  const d = resolveDesignTokens(theme, appearance, resolvedAccent);
  for (const [key, name] of DESIGN_COLOR_VARS) {
    out[name] = d[key];
  }

  return out;
}

// ────────────────────────────────────────────────────────────────
// React Native token emitter.
//
// Emits a plain TS module for apps/mobile containing:
//
//   themeVars       (theme, appearance, accent) → NativeWind `vars()` input
//   rawTokens       same data, for consumers that cannot read a CSS variable:
//                   Skia, the status bar, the xterm WebView theme, Live
//                   Activities
//   themeMeta       id/label/description/fonts/radius/swatch, so the mobile
//                   Appearance screen renders from the registry rather than
//                   from a second hand-maintained list
//   terminalThemes  (theme, appearance) → xterm ITheme
//   tailwindColors  colour name → `var(--name)`, for tailwind.config.js
//
// Why both var-shaped and literal: NativeWind resolves `var()` at style time,
// which is what we want for `className`. But Skia paints, native module props
// and the iOS status-bar API all take a literal string.
// ────────────────────────────────────────────────────────────────

import {
  ACCENT_IDS,
  DEFAULT_THEME,
  FILE_ICON_COLORS,
  FONT_SIZE,
  LINE_HEIGHT,
  MOTION,
  NATIVE_FONT_FAMILY,
  RADIUS,
  SPACING,
  THEMES,
  TWO_PANE_MIN_WIDTH,
  resolveAccentTokens,
  resolveAppearanceTokens,
  resolveChartRamp,
  resolveTerminalPalette,
  themeSwatch,
  type Appearance,
} from '../index.js';

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
  const a = resolveAccentTokens(
    theme,
    (ACCENT_IDS as readonly string[]).includes(accentId)
      ? (accentId as (typeof ACCENT_IDS)[number])
      : theme.defaultAccent,
    appearance,
  );
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

  resolveChartRamp(theme, appearance).forEach((colour, i) => {
    out[`--chart-${i + 1}`] = colour;
  });

  for (const [name, pair] of Object.entries(FILE_ICON_COLORS)) {
    out[`--file-icon-${name}`] = pair[appearance];
  }

  return out;
}

/** Colour names exposed as Tailwind utilities on mobile. */
export function tailwindColorNames(): string[] {
  const sample = resolveTokenSet(DEFAULT_THEME, 'dark', 'blue');
  return Object.keys(sample).map((v) => v.slice(2));
}

const stringify = (value: unknown, indent: number): string =>
  JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : ' '.repeat(indent) + line))
    .join('\n');

export function emitNative(): string {
  const appearances: Appearance[] = ['dark', 'light'];

  const themeVars: Record<string, Record<string, Record<string, ResolvedTokenSet>>> = {};
  const terminalThemes: Record<string, Record<string, unknown>> = {};
  const themeMeta: Array<Record<string, unknown>> = [];

  for (const theme of THEMES) {
    const perAppearance: Record<string, Record<string, ResolvedTokenSet>> = {};
    const perTerminal: Record<string, unknown> = {};

    for (const appearance of appearances) {
      const perAccent: Record<string, ResolvedTokenSet> = {};
      for (const accentId of ACCENT_IDS) {
        perAccent[accentId] = resolveTokenSet(theme.id, appearance, accentId);
      }
      perAppearance[appearance] = perAccent;
      perTerminal[appearance] = resolveTerminalPalette(theme, appearance);
    }

    themeVars[theme.id] = perAppearance;
    terminalThemes[theme.id] = perTerminal;

    themeMeta.push({
      id: theme.id,
      label: theme.label,
      description: theme.description,
      credit: theme.credit ?? null,
      defaultAccent: theme.defaultAccent,
      radius: theme.radius,
      swatch: { dark: themeSwatch(theme, 'dark'), light: themeSwatch(theme, 'light') },
    });
  }

  const tailwindColors: Record<string, string> = {};
  for (const name of tailwindColorNames()) {
    tailwindColors[name] = `var(--${name})`;
  }

  return `// ────────────────────────────────────────────────────────────────
// GENERATED FILE — do not edit.
//
// Source of truth: packages/design-tokens/src/themes/
// Regenerate:      pnpm --filter @generatorai/design-tokens tokens:write
//
// CI runs \`tokens:check\`, so an edit here fails the build rather than
// silently drifting from the web app.
// ────────────────────────────────────────────────────────────────

export type Appearance = 'dark' | 'light';

/** NativeWind \`vars()\` input, per (theme, appearance, accent). */
export const themeVars = ${stringify(themeVars, 0)} as const;

/**
 * Concrete colours for consumers that cannot resolve a CSS variable:
 * Skia paints, the native status bar, the xterm WebView theme.
 * Same data as \`themeVars\` — kept as one object so they cannot diverge.
 */
export const rawTokens = themeVars;

/** xterm \`ITheme\` per (theme, appearance). */
export const terminalThemes = ${stringify(terminalThemes, 0)} as const;

/** Registry metadata for the Appearance screen. */
export const themeMeta = ${stringify(themeMeta, 0)} as const;

/** For tailwind.config.js \`theme.extend.colors\`. */
export const tailwindColors = ${stringify(tailwindColors, 0)} as const;

export const radius = ${stringify(RADIUS, 0)} as const;
export const fontFamily = ${stringify(NATIVE_FONT_FAMILY, 0)} as const;
export const fontSize = ${stringify(FONT_SIZE, 0)} as const;
export const lineHeight = ${stringify(LINE_HEIGHT, 0)} as const;
export const spacing = ${stringify(SPACING, 0)} as const;
export const motion = ${stringify(MOTION, 0)} as const;

/** Width (dp) at or above which the two-pane desktop layout is restored. */
export const TWO_PANE_MIN_WIDTH = ${TWO_PANE_MIN_WIDTH};
`;
}

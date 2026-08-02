// ────────────────────────────────────────────────────────────────
// React Native token emitter.
//
// Emits a plain TS module for apps/mobile containing:
//
//   themeVars       (appearance, accent) → NativeWind `vars()` input
//   rawTokens       (appearance, accent) → concrete colours, for consumers
//                   that cannot read a CSS variable: Skia, the status bar,
//                   the xterm WebView theme, Live Activities.
//   tailwindColors  colour name → `var(--name)`, for tailwind.config.js
//
// Why both: NativeWind resolves `var()` at style time, which is what we want
// for `className`. But Skia paints, native module props and the iOS
// status-bar API all take a literal string.
// ────────────────────────────────────────────────────────────────

import {
  ACCENTS,
  APPEARANCE_TOKENS,
  FILE_ICON_COLORS,
  FONT_SIZE,
  LINE_HEIGHT,
  MOTION,
  NATIVE_FONT_FAMILY,
  RADIUS,
  SPACING,
  TWO_PANE_MIN_WIDTH,
  resolveAccent,
  type Appearance,
} from '../tokens.js';

/** camelCase token key → kebab-case CSS variable name. */
const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export interface ResolvedTokenSet {
  [cssVarName: string]: string;
}

/**
 * Every token for one (appearance, accent) pair, keyed by CSS variable name
 * so the shape is identical to the web's Layer 1.
 */
export function resolveTokenSet(appearance: Appearance, accentId: string): ResolvedTokenSet {
  const t = APPEARANCE_TOKENS[appearance];
  const a = resolveAccent(accentId, appearance);
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

  for (const [name, pair] of Object.entries(FILE_ICON_COLORS)) {
    out[`--file-icon-${name}`] = pair[appearance];
  }

  return out;
}

/** Colour names exposed as Tailwind utilities on mobile. */
export function tailwindColorNames(): string[] {
  const sample = resolveTokenSet('dark', 'blue');
  return Object.keys(sample).map((v) => v.slice(2));
}

const stringify = (value: unknown, indent: number): string =>
  JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : ' '.repeat(indent) + line))
    .join('\n');

export function emitNative(): string {
  const appearances: Appearance[] = ['dark', 'light'];

  const themeVars: Record<string, Record<string, ResolvedTokenSet>> = {};
  for (const appearance of appearances) {
    themeVars[appearance] = {};
    for (const accent of ACCENTS) {
      themeVars[appearance][accent.id] = resolveTokenSet(appearance, accent.id);
    }
  }

  const tailwindColors: Record<string, string> = {};
  for (const name of tailwindColorNames()) {
    tailwindColors[name] = `var(--${name})`;
  }

  return `// ────────────────────────────────────────────────────────────────
// GENERATED FILE — do not edit.
//
// Source of truth: packages/design-tokens/src/tokens.ts
// Regenerate:      pnpm --filter @generatorai/design-tokens tokens:write
//
// CI runs \`tokens:check\`, so an edit here fails the build rather than
// silently drifting from the web app.
// ────────────────────────────────────────────────────────────────

export type Appearance = 'dark' | 'light';

/** NativeWind \`vars()\` input, per (appearance, accent). */
export const themeVars = ${stringify(themeVars, 0)} as const;

/**
 * Concrete colours for consumers that cannot resolve a CSS variable:
 * Skia paints, the native status bar, the xterm WebView theme.
 * Same data as \`themeVars\` — kept as one object so they cannot diverge.
 */
export const rawTokens = themeVars;

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

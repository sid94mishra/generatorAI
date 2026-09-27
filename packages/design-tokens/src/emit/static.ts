// ────────────────────────────────────────────────────────────────
// Static desktop pages emitter (06-desktop-and-shell.md §7; P5-11, P1-R11
// follow-up).
//
// splash.html / error.html / prompt.html run with `default-src 'none'` (no
// script, `'self'` is unreliable for `file:` origins) so they cannot read
// localStorage or subscribe to appearance pushes the way the web app does.
// Instead they get ONE generated `:root { … }` block of Instrument LIGHT
// `--gai-*` colours plus a `@media (prefers-color-scheme: dark)` override —
// `nativeTheme.themeSource` mirrors the app's mode (D-25 §6.4), so the media
// query tracks it — and the scale variables (radius, type, control heights)
// these three small pages actually use. `bin/generate.ts` splices this
// between the same `@generated-tokens` markers as `globals.css`
// (`spliceCss` in `./css.js`), once per page.
//
// Before this, all three pages hard-coded GitHub-dark literals, so a
// light-theme user saw the persisted (correct) window background, then a
// GitHub-dark splash, then the app — the exact flash D-25 exists to remove
// (P1-review P1-R11).
// ────────────────────────────────────────────────────────────────

import { DESIGN_COLOR_VARS, HEIGHTS, TYPE_SCALE, radiusScale, resolveDesignTokens } from '../design.js';
import { DEFAULT_ACCENT } from '../registry.js';
import { DEFAULT_THEME, THEMES } from '../themes/index.js';
import type { Appearance, ThemeDef } from '../themes/types.js';

const defaultTheme = (): ThemeDef => THEMES.find((t) => t.id === DEFAULT_THEME) ?? (THEMES[0] as ThemeDef);

const em = (n: number): string => `${n}em`;

/** Every `--gai-*` colour, Instrument's default accent (ink) — appearance-only, one indent level. */
function colorLines(theme: ThemeDef, appearance: Appearance): string[] {
  const d = resolveDesignTokens(theme, appearance, DEFAULT_ACCENT);
  return DESIGN_COLOR_VARS.map(([key, name]) => `  ${name}: ${d[key]};`);
}

/** Radius, type scale and control heights — appearance-independent, emitted once on `:root`. */
function scaleLines(theme: ThemeDef): string[] {
  const lines: string[] = ['  /* Radius scale (D-14) */'];
  for (const [step, value] of Object.entries(radiusScale(theme.radius.DEFAULT))) {
    lines.push(`  --gai-radius-${step}: ${value}px;`);
  }
  lines.push('  /* Type scale (D-13) */');
  for (const [step, t] of Object.entries(TYPE_SCALE)) {
    lines.push(
      `  --gai-text-${step}: ${t.size}px;`,
      `  --gai-leading-${step}: ${t.lineHeight};`,
      `  --gai-weight-${step}: ${t.weight};`,
      `  --gai-tracking-${step}: ${em(t.tracking)};`,
    );
  }
  lines.push('  /* Control heights, comfortable density (D-15) */');
  for (const [name, value] of Object.entries(HEIGHTS.comfortable)) {
    lines.push(`  --gai-h-${name}: ${value}px;`);
  }
  lines.push(`  --font-sans: ${theme.fonts.sans};`, `  --font-mono: ${theme.fonts.mono};`);
  return lines;
}

/**
 * The two bundled families (D-16), pointing at `./fonts/…woff2` next to each
 * page — `apps/desktop/scripts/build-resources.mjs` `copyFonts()` puts them
 * there. Only the latin subset: these three pages need no more, and every
 * `url()` here counts toward the app's font budget once, not per page.
 */
function fontFaceBlock(): string {
  return [
    "@font-face {",
    "  font-family: 'Instrument Sans Variable';",
    '  font-style: normal;',
    '  font-display: swap;',
    '  font-weight: 400 700;',
    "  src: url('./fonts/instrument-sans-latin-wght-normal.woff2') format('woff2-variations');",
    '}',
    "@font-face {",
    "  font-family: 'JetBrains Mono Variable';",
    '  font-style: normal;',
    '  font-display: swap;',
    '  font-weight: 100 800;',
    "  src: url('./fonts/jetbrains-mono-latin-wght-normal.woff2') format('woff2-variations');",
    '}',
  ].join('\n');
}

/** The generated body spliced into each static page's `<style>` (markers added by the caller). */
export function emitStaticCss(): string {
  const theme = defaultTheme();
  return [
    ':root {',
    '  color-scheme: light dark;',
    ...colorLines(theme, 'light'),
    ...scaleLines(theme),
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    ...colorLines(theme, 'dark').map((line) => `  ${line}`),
    '  }',
    '}',
    fontFaceBlock(),
  ].join('\n');
}

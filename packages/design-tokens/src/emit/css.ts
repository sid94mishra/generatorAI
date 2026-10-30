// ────────────────────────────────────────────────────────────────
// Web CSS emitter.
//
// Produces the token layers that apps/web/src/styles/globals.css consumes.
// The generator splices this between marker comments so the hand-written base
// styles below the markers stay hand-written.
//
//   Layer 1  shared raw values that are neither legacy nor design-named and
//            survive P7 (02 §2.3 "Kept tokens"): fonts, canvas, chart ramp,
//            syntax, file-type icons — per theme × appearance
//   Layer 1b `--gai-*` design values, per theme × appearance × accent (02 §10.1)
//   Layer 1c `--gai-*` scales: density, font size, motion
//   Layer 2  `@theme inline` for the font families (the design utilities live
//            in css/vocabulary.css)
//
// The legacy layer (unprefixed shadcn-style colours, `--radius*`, the legacy
// `@theme` bridge and the `--color-*` compat aliases) was removed in P7-02.
//
// ── The specificity ladder ───────────────────────────────────────
//
// Three axes have to compose on one element (<html>) with no JavaScript
// beyond setting two attributes and a class. That is done purely with CSS
// specificity, and the order below is load-bearing:
//
//   :root                                          (0,1,0)  default theme, dark
//   .light                                         (0,1,0)  default theme, light
//   [data-theme="x"]                               (0,1,0)  theme x, dark
//   .light[data-theme="x"]                         (0,2,0)  theme x, light
//   [data-theme="x"][data-accent="a"]              (0,2,0)  theme x, dark, accent a
//   .light[data-theme="x"][data-accent="a"]        (0,3,0)  theme x, light, accent a
//
// Rows 1/2/3 and 4/5 tie on specificity, so they are broken by source order —
// which is why the emission order in `emitCss()` is not cosmetic. Reordering
// those sections silently gives light-mode users dark-mode accents.
//
// File-icon colours are emitted per appearance instead of via `light-dark()`.
// Both forms resolve identically on <html> today, but concrete values also
// survive a shadow root that declares its own `color-scheme` — which is exactly
// where these tokens are consumed.
// ────────────────────────────────────────────────────────────────

import {
  DESIGN_ACCENT_KEYS,
  DESIGN_COLOR_VARS,
  OVERLAY_COLOR_VARS,
  HEIGHTS,
  MOTION_CSS,
  CONTAINER_WIDTHS,
  TYPE_SCALE,
  Z_INDEX,
  radiusScale,
  resolveOverlayTokens,
  resolveDesignTokens,
  typeSizes,
} from '../design.js';
import { FONT_SIZES, DEFAULT_FONT_SIZE } from '../registry.js';
import { REQUIRED_UTILITIES } from '../vocabulary.js';
import {
  ACCENT_IDS,
  DEFAULT_THEME,
  FILE_ICON_COLORS,
  THEMES,
  resolveAppearanceTokens,
  resolveChartRamp,
  resolveSyntaxTokens,
  type AccentId,
  type Appearance,
  type ThemeDef,
} from '../index.js';

export const TOKENS_START_MARKER = '/* @generated-tokens:start — regenerate with `pnpm tokens:write`; do not edit by hand */';
export const TOKENS_END_MARKER = '/* @generated-tokens:end */';

const px = (n: number): string => `${n / 16}rem`;

const defaultTheme = (): ThemeDef =>
  THEMES.find((t) => t.id === DEFAULT_THEME) ?? (THEMES[0] as ThemeDef);

const SYNTAX_ROLES = [
  'comment',
  'keyword',
  'string',
  'number',
  'function',
  'type',
  'variable',
  'constant',
  'operator',
  'punctuation',
  'tag',
  'attribute',
  'deleted',
  'inserted',
] as const;

/**
 * The shared colours of a theme × appearance (02 §2.3 "Kept tokens"): the
 * React Flow canvas, the categorical chart ramp, the Shiki syntax theme and
 * the file-type icon palette. Accent-independent.
 */
function sharedAppearanceBlock(theme: ThemeDef, appearance: Appearance, selector: string): string {
  const t = resolveAppearanceTokens(theme, appearance);
  const chart = resolveChartRamp(theme, appearance);
  const syntax = resolveSyntaxTokens(theme, appearance);
  const lines: string[] = [`${selector} {`];

  lines.push('  /* Canvas (React Flow) */');
  lines.push(`  --canvas-bg: ${t.canvasBg};`);
  lines.push(`  --canvas-dot: ${t.canvasDot};`);

  lines.push('', '  /* Categorical chart ramp */');
  chart.forEach((colour, i) => lines.push(`  --chart-${i + 1}: ${colour};`));

  lines.push('', '  /* Syntax (Shiki theme of ui/patterns/CodeBlock) */');
  for (const role of SYNTAX_ROLES) {
    lines.push(`  --syntax-${role}: ${syntax[role]};`);
  }

  lines.push('', '  /* File-type icon palette (mirrors @pierre/trees) */');
  for (const [name, pair] of Object.entries(FILE_ICON_COLORS)) {
    lines.push(`  --file-icon-${name}: ${pair[appearance]};`);
  }

  lines.push('}');
  return lines.join('\n');
}

/** A theme's font families — appearance-independent, emitted once per theme. */
function themeFontBlock(theme: ThemeDef, selector: string): string {
  return [`${selector} {`, `  --font-sans: ${theme.fonts.sans};`, `  --font-mono: ${theme.fonts.mono};`, '}'].join('\n');
}

/** Tailwind's `font-sans` / `font-mono` follow the active theme's families. */
function fontThemeBlock(): string {
  return ['@theme inline {', '  --font-sans: var(--font-sans);', '  --font-mono: var(--font-mono);', '}'].join('\n');
}

const designVar = (key: keyof ReturnType<typeof resolveDesignTokens>): string =>
  DESIGN_COLOR_VARS.find(([k]) => k === key)?.[1] as string;

/** Every `--gai-*` colour for one theme × appearance (its default accent). */
function designAppearanceBlock(theme: ThemeDef, appearance: Appearance, selector: string): string {
  const d = resolveDesignTokens(theme, appearance, theme.defaultAccent);
  const lines = [`${selector} {`, `  color-scheme: ${appearance};`];
  for (const [key, name] of DESIGN_COLOR_VARS) lines.push(`  ${name}: ${d[key]};`);
  const o = resolveOverlayTokens(d);
  for (const [key, name] of OVERLAY_COLOR_VARS) lines.push(`  ${name}: ${o[key]};`);
  if (appearance === 'dark') {
    // Radius is appearance-independent, so it rides on the dark (base) block
    // only; the light block overrides colours alone (D-14, 02 §6.1).
    lines.push(`  /* Radius scale from base ${theme.radius.DEFAULT}px (D-14) */`);
    for (const [step, value] of Object.entries(radiusScale(theme.radius.DEFAULT))) {
      lines.push(`  --gai-radius-${step}: ${value}px;`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

/** The accent-dependent `--gai-*` colours for one theme × accent × appearance. */
function designAccentBlock(theme: ThemeDef, accentId: AccentId, appearance: Appearance): string {
  const base = `[data-theme="${theme.id}"][data-accent="${accentId}"]`;
  const d = resolveDesignTokens(theme, appearance, accentId);
  return [
    `${appearance === 'dark' ? base : `.light${base}`} {`,
    ...DESIGN_ACCENT_KEYS.map((key) => `  ${designVar(key)}: ${d[key]};`),
    '}',
  ].join('\n');
}

export const DESIGN_LAYER_HEADER = '/* ── Layer 1b — design values (--gai-*) ── */';

/**
 * Inside a floating layer the overlay is the base surface (D-165): `raised`
 * is the overlay itself and `sunken` / `line-soft` keep their page step on it,
 * so fields, segmented tracks, secondary buttons and dividers in a dialog look
 * as they do on a page. Every floating layer carries `data-gai-overlay` (D-19).
 */
function overlayRebaseBlock(): string {
  return [
    '[data-gai-overlay] {',
    '  --gai-raised: var(--gai-overlay);',
    ...OVERLAY_COLOR_VARS.map(([key, name]) => `  ${designVar(key)}: var(${name});`),
    '}',
  ].join('\n');
}

/**
 * Layer 1b: the design layer, on the specificity ladder above. Unlike Layer 1,
 * the default theme also gets explicit `[data-theme]` blocks, so an attribute on
 * any element (a Storybook decorator) fully describes its theme.
 */
function designLayer(base: ThemeDef): string[] {
  const sections: string[] = [
    [
      DESIGN_LAYER_HEADER,
      '/* Design-named colours (02 §2), reached through the utilities in',
      '   css/vocabulary.css. */',
    ].join('\n'),
    designAppearanceBlock(base, 'dark', ':root'),
    designAppearanceBlock(base, 'light', '.light'),
  ];
  for (const theme of THEMES) {
    sections.push(designAppearanceBlock(theme, 'dark', `[data-theme="${theme.id}"]`));
    sections.push(designAppearanceBlock(theme, 'light', `.light[data-theme="${theme.id}"]`));
  }
  for (const theme of THEMES) {
    for (const accentId of ACCENT_IDS) {
      if (accentId === theme.defaultAccent) continue;
      sections.push(designAccentBlock(theme, accentId, 'dark'));
      sections.push(designAccentBlock(theme, accentId, 'light'));
    }
  }
  sections.push(overlayRebaseBlock());
  return sections;
}

const em = (n: number): string => `${n}em`;

/**
 * Layer 1c: the theme- and appearance-independent axes (02 §10.1 item 3).
 * `:root` carries the defaults (comfortable, 13px, full motion); each axis
 * override is a single attribute selector emitted after it, so the same
 * attribute on any element (a Storybook decorator) re-scales its subtree.
 */
function axisLayer(): string[] {
  const root = [':root {', '  /* Heights — comfortable density (D-15) */'];
  for (const [name, value] of Object.entries(HEIGHTS.comfortable)) root.push(`  --gai-h-${name}: ${value}px;`);
  root.push(`  /* Type — interface font size ${DEFAULT_FONT_SIZE} (D-13) */`);
  for (const [step, t] of Object.entries(TYPE_SCALE)) {
    root.push(
      `  --gai-text-${step}: ${t.size}px;`,
      `  --gai-leading-${step}: ${t.lineHeight};`,
      `  --gai-weight-${step}: ${t.weight};`,
      `  --gai-tracking-${step}: ${em(t.tracking)};`,
    );
  }
  root.push('  /* Motion (D-20) */');
  for (const [name, value] of Object.entries(MOTION_CSS.duration)) root.push(`  --gai-duration-${name}: ${value};`);
  for (const [name, value] of Object.entries(MOTION_CSS.ease)) root.push(`  --gai-ease-${name}: ${value};`);
  root.push('  /* Stacking layers (D-41) */');
  for (const [name, value] of Object.entries(Z_INDEX)) root.push(`  --gai-z-${name}: ${value};`);
  root.push('  /* Shell widths (D-15, 02 §8) */');
  for (const [name, value] of Object.entries(CONTAINER_WIDTHS)) root.push(`  --gai-w-${name}: ${value}px;`);
  root.push('}');

  const compact = ['[data-density="compact"] {'];
  for (const [name, value] of Object.entries(HEIGHTS.compact)) compact.push(`  --gai-h-${name}: ${value}px;`);
  compact.push('}');

  const fontSizes = FONT_SIZES.filter((size) => size !== DEFAULT_FONT_SIZE).map((size) => {
    const lines = [`[data-font-size="${size}"] {`];
    for (const [step, px] of Object.entries(typeSizes(size))) lines.push(`  --gai-text-${step}: ${px}px;`);
    lines.push('}');
    return lines.join('\n');
  });

  const reduce = ['[data-motion="reduce"] {'];
  for (const name of Object.keys(MOTION_CSS.duration)) reduce.push(`  --gai-duration-${name}: 0ms;`);
  reduce.push('}');

  return [
    [
      '/* ── Layer 1c — design scales (--gai-*): density, font size, motion ──',
      '   Each override is one attribute selector after :root; source order wins the tie. */',
    ].join('\n'),
    root.join('\n'),
    compact.join('\n'),
    ...fontSizes,
    reduce.join('\n'),
  ];
}

/**
 * Tailwind emits a utility only when it finds the class in a source file. The
 * CSS-emission check (09 §2.4) asserts the required design utilities are built
 * and token-backed before any page uses them, so they are safelisted here.
 * Emitting unused rules changes no rendered pixel.
 */
function requiredUtilitiesSafelist(): string {
  return `@source inline("${REQUIRED_UTILITIES.join(' ')}");`;
}

/** The full generated CSS body (without the surrounding markers). */
export function emitCss(): string {
  const sections: string[] = [];
  const base = defaultTheme();

  sections.push(
    [
      '/* ══════════════════════════════════════════════════════════════',
      '   Layer 1 — shared raw values (fonts, canvas, chart, syntax,',
      '   file icons). Emission ORDER is load-bearing: rows of equal',
      '   specificity are resolved by source order (emit/css.ts header).',
      '   ══════════════════════════════════════════════════════════════ */',
    ].join('\n'),
  );

  // 1. Default theme, both appearances — the state before any attribute is set.
  sections.push(themeFontBlock(base, ':root'));
  sections.push(sharedAppearanceBlock(base, 'dark', ':root'));
  sections.push(sharedAppearanceBlock(base, 'light', '.light'));

  // 2. Per-theme fonts, including the default so that an explicit `data-theme`
  //    always fully describes the theme; then non-default themes, dark first,
  //    then light (which must win on .light).
  sections.push('/* ── Per-theme fonts ── */');
  for (const theme of THEMES) sections.push(themeFontBlock(theme, `[data-theme="${theme.id}"]`));
  sections.push('/* ── Named themes: dark block first, then the (0,2,0) light override ── */');
  for (const theme of THEMES) {
    if (theme.id === base.id) continue;
    sections.push(sharedAppearanceBlock(theme, 'dark', `[data-theme="${theme.id}"]`));
    sections.push(sharedAppearanceBlock(theme, 'light', `.light[data-theme="${theme.id}"]`));
  }

  sections.push(...designLayer(base));
  sections.push(...axisLayer());

  sections.push(
    [
      '/* ══════════════════════════════════════════════════════════════',
      '   Layer 2 — font families. Design utilities are mapped in',
      '   css/vocabulary.css (imported at the top of globals.css); the',
      '   required ones are always built (09 §2.4).',
      '   ══════════════════════════════════════════════════════════════ */',
    ].join('\n'),
  );
  sections.push(fontThemeBlock());
  sections.push(requiredUtilitiesSafelist());

  return sections.join('\n\n');
}

/** Splice the generated body into an existing file between the markers. */
export function spliceCss(existing: string, generated: string): string {
  const start = existing.indexOf(TOKENS_START_MARKER);
  const end = existing.indexOf(TOKENS_END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      'globals.css is missing the @generated-tokens markers. ' +
        'Add them around the token layers before running the generator.',
    );
  }
  const head = existing.slice(0, start + TOKENS_START_MARKER.length);
  const tail = existing.slice(end);
  return `${head}\n\n${generated}\n\n${tail}`;
}

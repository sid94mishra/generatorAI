// ────────────────────────────────────────────────────────────────
// Web CSS emitter.
//
// Produces the token layers that apps/web/src/styles/globals.css consumes.
// The generator splices this between marker comments so the hand-written base
// styles below the markers stay hand-written.
//
//   Layer 1  raw semantic values, per theme × appearance × accent (legacy)
//   Layer 1b `--gai-*` design values, same ladder (02 §10.1)
//   Layer 2  `@theme inline` — makes the legacy values Tailwind utilities
//            (the design utilities live in css/vocabulary.css)
//   Layer 3  `--color-*` compat aliases for legacy arbitrary values
//   Layer 4  highlight.js rules, driven by the theme's syntax tokens
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
// ── Two deliberate simplifications ───────────────────────────────
//
// 1. Accent tints are DERIVED for every accent, including the default. The
//    original hand-written blue literals were `#1f6feb22` / `#0969da15`;
//    deriving them gives `#1f6feb21` / `#0969da14` — a one-step (1/255) alpha
//    change on two tokens, below the 8-bit rounding of the percentage those
//    literals were meant to express. Uniform derivation is worth more than
//    bug-for-bug fidelity to two typos.
//
// 2. File-icon colours are emitted per appearance instead of via
//    `light-dark()`. Both forms resolve identically on <html> today, but
//    concrete values also survive a shadow root that declares its own
//    `color-scheme` — which is exactly where these tokens are consumed.
// ────────────────────────────────────────────────────────────────

import { DESIGN_ACCENT_KEYS, DESIGN_COLOR_VARS, resolveDesignTokens } from '../design.js';
import {
  LEGACY_BRIDGE_SOURCE,
  LEGACY_COLOR_NAMES,
  REQUIRED_UTILITIES,
  SHARED_COLOR_NAMES,
} from '../vocabulary.js';
import {
  ACCENT_IDS,
  DEFAULT_THEME,
  FILE_ICON_COLORS,
  THEMES,
  resolveAccentTokens,
  resolveAppearanceTokens,
  resolveChartRamp,
  resolveSyntaxTokens,
  type AccentId,
  type Appearance,
  type AppearanceTokens,
  type ThemeDef,
} from '../index.js';

export const TOKENS_START_MARKER = '/* @generated-tokens:start — regenerate with `pnpm tokens:write`; do not edit by hand */';
export const TOKENS_END_MARKER = '/* @generated-tokens:end */';

const px = (n: number): string => `${n / 16}rem`;

const defaultTheme = (): ThemeDef =>
  THEMES.find((t) => t.id === DEFAULT_THEME) ?? (THEMES[0] as ThemeDef);

/** CSS custom-property name for each appearance token, in emission order. */
const APPEARANCE_VARS: Array<[keyof AppearanceTokens, string]> = [
  ['background', '--background'],
  ['foreground', '--foreground'],
  ['card', '--card'],
  ['cardForeground', '--card-foreground'],
  ['popover', '--popover'],
  ['popoverForeground', '--popover-foreground'],
  ['raised', '--raised'],
  ['overlay', '--overlay'],
  ['subtle', '--subtle'],
  ['emphasis', '--emphasis'],
  ['surface', '--surface'],
  ['surfaceHover', '--surface-hover'],
  ['primaryForeground', '--primary-foreground'],
  ['secondary', '--secondary'],
  ['secondaryForeground', '--secondary-foreground'],
  ['muted', '--muted'],
  ['mutedForeground', '--muted-foreground'],
  ['accentForeground', '--accent-foreground'],
  ['destructive', '--destructive'],
  ['destructiveForeground', '--destructive-foreground'],
  ['border', '--border'],
  ['borderMuted', '--border-muted'],
  ['input', '--input'],
  ['success', '--success'],
  ['successMuted', '--success-muted'],
  ['warning', '--warning'],
  ['warningMuted', '--warning-muted'],
  ['info', '--info'],
  ['infoMuted', '--info-muted'],
  ['danger', '--danger'],
  ['dangerMuted', '--danger-muted'],
  ['done', '--done'],
  ['sidebar', '--sidebar'],
  ['sidebarForeground', '--sidebar-foreground'],
  ['sidebarBorder', '--sidebar-border'],
  ['canvasBg', '--canvas-bg'],
  ['canvasDot', '--canvas-dot'],
];

const varName = (key: keyof AppearanceTokens): string =>
  APPEARANCE_VARS.find(([k]) => k === key)?.[1] ?? `--${key}`;

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

/** Raw variable behind a legacy bridge name. */
const bridgeSource = (name: (typeof LEGACY_COLOR_NAMES)[number]): string =>
  LEGACY_BRIDGE_SOURCE[name] ?? name;

/**
 * The colour half of a theme × appearance: everything except fonts and radii,
 * which are appearance-independent and emitted once per theme.
 */
function appearanceBlock(theme: ThemeDef, appearance: Appearance, selector: string): string {
  const t = resolveAppearanceTokens(theme, appearance);
  const a = resolveAccentTokens(theme, theme.defaultAccent, appearance);
  const chart = resolveChartRamp(theme, appearance);
  const syntax = resolveSyntaxTokens(theme, appearance);
  const lines: string[] = [`${selector} {`, `  color-scheme: ${appearance};`, ''];

  lines.push('  /* Surfaces */');
  for (const key of ['background', 'foreground', 'card', 'cardForeground', 'popover', 'popoverForeground', 'raised', 'overlay', 'subtle', 'emphasis', 'surface', 'surfaceHover'] as const) {
    lines.push(`  ${varName(key)}: ${t[key]};`);
  }

  lines.push('', `  /* Interactive — accent axis, default '${theme.defaultAccent}' */`);
  lines.push(`  --primary: ${a.primary};`);
  lines.push(`  --primary-emphasis: ${a.primaryEmphasis};`);
  lines.push(`  --primary-foreground: ${a.onAccent};`);
  lines.push(`  --secondary: ${t.secondary};`);
  lines.push(`  --secondary-foreground: ${t.secondaryForeground};`);
  lines.push(`  --muted: ${t.muted};`);
  lines.push(`  --muted-foreground: ${t.mutedForeground};`);
  lines.push(`  --accent: ${a.accent};`);
  lines.push(`  --accent-foreground: ${t.accentForeground};`);
  lines.push(`  --destructive: ${t.destructive};`);
  lines.push(`  --destructive-foreground: ${t.destructiveForeground};`);

  lines.push('', '  /* Borders */');
  lines.push(`  --border: ${t.border};`);
  lines.push(`  --border-muted: ${t.borderMuted};`);
  lines.push(`  --input: ${t.input};`);
  lines.push(`  --ring: ${a.ring};`);

  lines.push('', '  /* Status — semantic, never accent-controlled */');
  for (const key of ['success', 'successMuted', 'warning', 'warningMuted', 'info', 'infoMuted', 'danger', 'dangerMuted', 'done'] as const) {
    lines.push(`  ${varName(key)}: ${t[key]};`);
  }

  lines.push('', '  /* Sidebar */');
  lines.push(`  --sidebar: ${t.sidebar};`);
  lines.push(`  --sidebar-foreground: ${t.sidebarForeground};`);
  lines.push(`  --sidebar-border: ${t.sidebarBorder};`);
  lines.push(`  --sidebar-accent: ${a.sidebarAccent};`);
  lines.push(`  --sidebar-accent-foreground: ${a.sidebarAccentForeground};`);

  lines.push('', '  /* Canvas (React Flow) */');
  lines.push(`  --canvas-bg: ${t.canvasBg};`);
  lines.push(`  --canvas-dot: ${t.canvasDot};`);

  lines.push('', '  /* Categorical chart ramp */');
  chart.forEach((colour, i) => lines.push(`  --chart-${i + 1}: ${colour};`));

  lines.push('', '  /* Syntax (highlight.js) */');
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

/**
 * Fonts and radii — the parts of a theme that do not change between light and
 * dark. Emitted once per theme so the light/dark blocks stay purely chromatic.
 */
function themeChromeBlock(theme: ThemeDef, selector: string): string {
  return [
    `${selector} {`,
    `  --font-sans: ${theme.fonts.sans};`,
    `  --font-mono: ${theme.fonts.mono};`,
    `  --radius: ${px(theme.radius.DEFAULT)};`,
    `  --radius-lg: ${px(theme.radius.lg)};`,
    `  --radius-xl: ${px(theme.radius.xl)};`,
    '}',
  ].join('\n');
}

function accentBlock(theme: ThemeDef, accentId: AccentId, appearance: Appearance): string {
  const base = `[data-theme="${theme.id}"][data-accent="${accentId}"]`;
  const selector = appearance === 'dark' ? base : `.light${base}`;
  const a = resolveAccentTokens(theme, accentId, appearance);
  return [
    `${selector} {`,
    `  --primary: ${a.primary};`,
    `  --primary-emphasis: ${a.primaryEmphasis};`,
    `  --primary-foreground: ${a.onAccent};`,
    `  --ring: ${a.ring};`,
    `  --accent: ${a.accent};`,
    `  --sidebar-accent: ${a.sidebarAccent};`,
    `  --sidebar-accent-foreground: ${a.sidebarAccentForeground};`,
    '}',
  ].join('\n');
}

function themeInlineBlock(): string {
  const lines = ['@theme inline {'];
  for (const name of LEGACY_COLOR_NAMES) {
    lines.push(`  --color-${name}: var(--${bridgeSource(name)});`);
  }
  lines.push('  --font-sans: var(--font-sans);');
  lines.push('  --font-mono: var(--font-mono);');
  lines.push('}');
  return lines.join('\n');
}

function compatAliasBlock(): string {
  const lines = [':root {'];
  for (const name of LEGACY_COLOR_NAMES) {
    lines.push(`  --color-${name}: var(--${bridgeSource(name)});`);
  }
  // The shared tokens' utilities live in vocabulary.css; these aliases keep the
  // hand-written `var(--color-canvas-bg)` rules (React Flow) resolving.
  for (const name of SHARED_COLOR_NAMES) {
    lines.push(`  --color-${name}: var(--${name});`);
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * highlight.js colouring, expressed against the theme's syntax tokens.
 *
 * This replaces the two imported stylesheets (github / github-dark) that used
 * to be swapped by a <link> href. Those only had two variants, so on any other
 * theme the code block was the one region of the app still rendering GitHub's
 * palette. Driving hljs from variables also removes a stylesheet fetch and the
 * flash that came with it.
 *
 * The class list is hljs's own; roles it does not distinguish (params, meta)
 * deliberately fall through to `--foreground`.
 */
function syntaxRulesBlock(): string {
  const rule = (selectors: string[], role: string): string =>
    `${selectors.join(',\n')} { color: var(--syntax-${role}); }`;

  return [
    '.hljs { color: var(--foreground); background: transparent; }',
    rule(['.hljs-comment', '.hljs-quote'], 'comment'),
    rule(['.hljs-keyword', '.hljs-selector-tag', '.hljs-literal', '.hljs-doctag', '.hljs-formula'], 'keyword'),
    rule(['.hljs-string', '.hljs-regexp', '.hljs-addition', '.hljs-attribute', '.hljs-meta .hljs-string'], 'string'),
    rule(['.hljs-number', '.hljs-symbol', '.hljs-bullet', '.hljs-link'], 'number'),
    rule(['.hljs-title', '.hljs-section', '.hljs-title.function_', '.hljs-name'], 'function'),
    rule(['.hljs-type', '.hljs-class .hljs-title', '.hljs-title.class_', '.hljs-built_in'], 'type'),
    rule(['.hljs-variable', '.hljs-template-variable', '.hljs-params'], 'variable'),
    rule(['.hljs-selector-id', '.hljs-selector-class', '.hljs-selector-attr', '.hljs-selector-pseudo'], 'constant'),
    rule(['.hljs-operator', '.hljs-meta', '.hljs-meta .hljs-keyword'], 'operator'),
    rule(['.hljs-punctuation', '.hljs-subst'], 'punctuation'),
    rule(['.hljs-tag', '.hljs-template-tag'], 'tag'),
    rule(['.hljs-attr', '.hljs-property'], 'attribute'),
    '.hljs-deletion { color: var(--syntax-deleted); }',
    '.hljs-addition { color: var(--syntax-inserted); }',
    '.hljs-emphasis { font-style: italic; }',
    '.hljs-strong { font-weight: 600; }',
  ].join('\n');
}

const designVar = (key: keyof ReturnType<typeof resolveDesignTokens>): string =>
  DESIGN_COLOR_VARS.find(([k]) => k === key)?.[1] as string;

/** Every `--gai-*` colour for one theme × appearance (its default accent). */
function designAppearanceBlock(theme: ThemeDef, appearance: Appearance, selector: string): string {
  const d = resolveDesignTokens(theme, appearance, theme.defaultAccent);
  const lines = [`${selector} {`, `  color-scheme: ${appearance};`];
  for (const [key, name] of DESIGN_COLOR_VARS) lines.push(`  ${name}: ${d[key]};`);
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
 * Layer 1b: the design layer, with the same specificity ladder as Layer 1 in a
 * section of its own so P7 can delete Layer 1 wholesale. Unlike Layer 1, the
 * default theme also gets explicit `[data-theme]` blocks, so an attribute on
 * any element (a Storybook decorator) fully describes its theme.
 */
function designLayer(base: ThemeDef): string[] {
  const sections: string[] = [
    [
      DESIGN_LAYER_HEADER,
      '/* Design-named colours (02 §2). Legacy pages never read these; ported',
      '   pages reach them through the utilities in css/vocabulary.css. */',
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
  return sections;
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
      '   Layer 1 — raw semantic values.',
      '   Components never read these directly; they use the Tailwind',
      '   utilities produced by Layer 2.',
      '',
      '   Emission ORDER is load-bearing: rows of equal specificity are',
      '   resolved by source order. See the header comment in emit/css.ts.',
      '   ══════════════════════════════════════════════════════════════ */',
    ].join('\n'),
  );

  // 1. Default theme, both appearances — the state before any attribute is set.
  sections.push(themeChromeBlock(base, ':root'));
  sections.push(appearanceBlock(base, 'dark', ':root'));
  sections.push(appearanceBlock(base, 'light', '.light'));

  // 2. Per-theme chrome (fonts + radii), including the default so that an
  //    explicit `data-theme` always fully describes the theme.
  sections.push('/* ── Per-theme type + radius ── */');
  for (const theme of THEMES) {
    sections.push(themeChromeBlock(theme, `[data-theme="${theme.id}"]`));
  }

  // 3. Non-default themes: dark first, then light (which must win on .light).
  sections.push(
    [
      '/* ── Named themes ──',
      '   Dark block first so the light override lands after it with a',
      '   higher specificity (.light[data-theme] beats [data-theme]). */',
    ].join('\n'),
  );
  for (const theme of THEMES) {
    if (theme.id === base.id) continue;
    sections.push(appearanceBlock(theme, 'dark', `[data-theme="${theme.id}"]`));
    sections.push(appearanceBlock(theme, 'light', `.light[data-theme="${theme.id}"]`));
  }

  // 4. Accents, scoped to their theme so a Catppuccin user never gets a
  //    GitHub accent. Emitted last: the light rows outrank every theme block.
  sections.push(
    [
      '/* ── Accent axis (orthogonal to theme and appearance) ──',
      '   Each accent overrides ONLY interactive tokens. Surfaces, text and',
      '   status colours are untouched: "danger" must look like danger no',
      "   matter what the user's accent preference is. */",
    ].join('\n'),
  );
  for (const theme of THEMES) {
    for (const accentId of ACCENT_IDS) {
      if (accentId === theme.defaultAccent) continue; // already inlined above
      sections.push(accentBlock(theme, accentId, 'dark'));
      sections.push(accentBlock(theme, accentId, 'light'));
    }
  }

  sections.push(...designLayer(base));

  sections.push(
    [
      '/* ══════════════════════════════════════════════════════════════',
      '   Layer 2 — Tailwind utility bridge. Makes `bg-background`,',
      '   `text-muted-foreground`, `bg-success-muted`, `ring-ring`… real',
      '   utilities that follow the active theme + accent.',
      '   ══════════════════════════════════════════════════════════════ */',
    ].join('\n'),
  );
  sections.push(themeInlineBlock());
  sections.push(
    [
      '/* Design utilities are mapped in css/vocabulary.css (imported at the top of',
      '   globals.css). The required ones are always built (09 §2.4). */',
      requiredUtilitiesSafelist(),
    ].join('\n'),
  );

  sections.push(
    [
      '/* ══════════════════════════════════════════════════════════════',
      '   Layer 3 — compat aliases. Keeps every pre-existing',
      '   `var(--color-*)` arbitrary value resolving, dynamically, so',
      '   theme/accent switches still apply. New code should use Layer 2.',
      '   ══════════════════════════════════════════════════════════════ */',
    ].join('\n'),
  );
  sections.push(compatAliasBlock());

  sections.push(
    [
      '/* ══════════════════════════════════════════════════════════════',
      '   Layer 4 — highlight.js, driven by the theme\'s syntax tokens',
      '   instead of a swapped stylesheet. See emit/css.ts.',
      '   ══════════════════════════════════════════════════════════════ */',
    ].join('\n'),
  );
  sections.push(syntaxRulesBlock());

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

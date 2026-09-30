// ────────────────────────────────────────────────────────────────
// Emitter tests.
//
// `tokens.test.ts` proves the token DATA is correct. This file proves the
// generated CSS actually delivers it, which is a separate failure mode: a
// palette can be flawless and still never reach the page because its selector
// was misspelled, omitted, or emitted in an order that loses a specificity
// tie.
//
// The specificity assertions matter most. Three axes compose on one element
// with no JavaScript beyond two attribute writes, and two of the rungs tie at
// (0,2,0) — they are resolved purely by source order. That is invisible in
// review and produces a bug ("light mode shows dark accents") that only
// appears for users who changed two settings. So the order is asserted here
// rather than trusted to the comment above it.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { DESIGN_ACCENT_KEYS, DESIGN_COLOR_VARS } from '../design.js';
import { DESIGN_LAYER_HEADER, emitCss, spliceCss, TOKENS_END_MARKER, TOKENS_START_MARKER } from '../emit/css.js';
import { emitNative } from '../emit/native.js';
import { emitVocabularyCss, emitVocabularyJson, vocabularyJson } from '../emit/vocabulary.js';
import { ACCENT_IDS, DEFAULT_THEME, THEMES } from '../themes/index.js';
import {
  COLOR_NAMES,
  LEGACY_COLOR_NAMES,
  LEGACY_UTILITY_NAMES,
  REQUIRED_UTILITIES,
  SHARED_COLOR_NAMES,
  TEXT_COLOR_OVERRIDES,
} from '../vocabulary.js';

const css = emitCss();

/** Index of a selector in the emitted stylesheet, or -1. */
const at = (selector: string): number => css.indexOf(`${selector} {`);

describe('web CSS emitter', () => {
  it('emits a dark and a light block for every non-default theme', () => {
    for (const theme of THEMES) {
      if (theme.id === DEFAULT_THEME) continue;
      expect(at(`[data-theme="${theme.id}"]`), `${theme.id} dark block`).toBeGreaterThan(-1);
      expect(at(`.light[data-theme="${theme.id}"]`), `${theme.id} light block`).toBeGreaterThan(-1);
    }
  });

  it('emits the default theme into :root and .light so a bare page is themed', () => {
    // Without this, the app renders unstyled until the provider hydrates.
    expect(at(':root')).toBeGreaterThan(-1);
    expect(at('.light')).toBeGreaterThan(-1);
  });

  it('scopes every accent block to its theme', () => {
    // An unscoped `[data-accent="violet"]` would give a Catppuccin user
    // GitHub's violet — the exact bug the theme axis exists to prevent.
    for (const theme of THEMES) {
      for (const accentId of ACCENT_IDS) {
        if (accentId === theme.defaultAccent) continue;
        const base = `[data-theme="${theme.id}"][data-accent="${accentId}"]`;
        expect(at(base), `${theme.id}/${accentId} dark`).toBeGreaterThan(-1);
        expect(at(`.light${base}`), `${theme.id}/${accentId} light`).toBeGreaterThan(-1);
      }
    }
  });

  it('never emits an accent selector that is not theme-scoped', () => {
    const unscoped = css.match(/^\[data-accent="[^"]+"\]|^\.light\[data-accent="[^"]+"\]/gm);
    expect(unscoped).toBeNull();
  });

  it('orders the specificity ladder so later rungs win their ties', () => {
    // `.light[data-theme=x]` and `[data-theme=x][data-accent=a]` are BOTH
    // (0,2,0). Source order is the only tie-breaker, so a theme's light block
    // must precede its accent blocks, and the light accent block — which is
    // (0,3,0) and outranks everything — comes last.
    for (const theme of THEMES) {
      if (theme.id === DEFAULT_THEME) continue;
      const darkTheme = at(`[data-theme="${theme.id}"]`);
      const lightTheme = at(`.light[data-theme="${theme.id}"]`);
      expect(darkTheme, `${theme.id}: dark block must precede light`).toBeLessThan(lightTheme);

      const accentId = ACCENT_IDS.find((a) => a !== theme.defaultAccent)!;
      const base = `[data-theme="${theme.id}"][data-accent="${accentId}"]`;
      expect(
        lightTheme,
        `${theme.id}: light theme block must precede its accent blocks`,
      ).toBeLessThan(at(base));
      expect(at(base), `${theme.id}: light accent must come last`).toBeLessThan(at(`.light${base}`));
    }
  });

  it('emits the tokens every consumer reads', () => {
    // A token that exists in TS but never reaches CSS fails silently: the
    // component just renders the inherited colour.
    for (const name of [
      '--canvas-bg',
      '--canvas-dot',
      '--chart-1',
      '--chart-6',
      '--syntax-keyword',
      '--syntax-comment',
      '--font-sans',
      '--font-mono',
      '--gai-ground',
      '--gai-fg-3',
    ]) {
      expect(css, `${name} missing`).toContain(`${name}:`);
    }
  });

  it('no longer emits the legacy layer (P7-02)', () => {
    // Unprefixed shadcn-style colours, `--radius*`, the legacy `@theme` bridge
    // and the `--color-*` compat aliases are gone; design utilities come from
    // css/vocabulary.css only.
    for (const name of ['--background:', '--foreground:', '--primary:', '--muted-foreground:', '--sidebar-accent:', '--radius:', '--radius-lg:']) {
      expect(css, `${name} still emitted`).not.toContain(`  ${name}`);
    }
    for (const name of [...LEGACY_COLOR_NAMES, ...SHARED_COLOR_NAMES, ...COLOR_NAMES]) {
      expect(css, `--color-${name} still emitted`).not.toContain(`--color-${name}:`);
    }
  });

  it('exposes syntax roles as per-theme custom properties, with no highlight.js rules', () => {
    // The Shiki theme (apps/web ui/patterns/CodeBlock/highlighter.ts) colours
    // tokens with `var(--syntax-*)`; highlight.js markup is no longer rendered.
    for (const theme of THEMES) {
      const block = css.slice(at(`[data-theme="${theme.id}"]`));
      expect(block, `${theme.id} syntax roles`).toContain('--syntax-keyword:');
    }
    expect(css).not.toContain('.hljs');
  });

  it('gives every theme its own type stack', () => {
    for (const theme of THEMES) {
      const block = css.slice(at(`[data-theme="${theme.id}"]`));
      expect(block, `${theme.id} fonts`).toContain('--font-sans:');
    }
  });
});

describe('design layer (L1b)', () => {
  const start = css.indexOf(DESIGN_LAYER_HEADER);
  const end = css.indexOf('Layer 2 — font families');
  const l1b = css.slice(start, end);
  const inL1b = (selector: string): number => l1b.indexOf(`\n${selector} {`);
  const block = (selector: string): string => {
    const i = inL1b(selector);
    return i === -1 ? '' : l1b.slice(i, l1b.indexOf('}', i));
  };

  it('is its own section after Layer 1 and before Layer 2', () => {
    expect(start).toBeGreaterThan(css.indexOf('/* ── Named themes'));
    expect(end).toBeGreaterThan(start);
  });

  it('defines every design colour in :root, .light and every theme block', () => {
    const selectors = [':root', '.light', ...THEMES.flatMap((t) => [`[data-theme="${t.id}"]`, `.light[data-theme="${t.id}"]`])];
    for (const selector of selectors) {
      const body = block(selector);
      expect(body, `${selector} missing from L1b`).not.toBe('');
      for (const [, name] of DESIGN_COLOR_VARS) expect(body, `${selector} ${name}`).toContain(`  ${name}: `);
    }
  });

  it('orders the ladder per theme: dark < light < accent dark < accent light', () => {
    for (const theme of THEMES) {
      const accentId = ACCENT_IDS.find((a) => a !== theme.defaultAccent)!;
      const base = `[data-theme="${theme.id}"][data-accent="${accentId}"]`;
      const order = [`[data-theme="${theme.id}"]`, `.light[data-theme="${theme.id}"]`, base, `.light${base}`].map(inL1b);
      for (const i of order) expect(i, theme.id).toBeGreaterThan(-1);
      expect([...order].sort((a, b) => a - b), `${theme.id}: ${order.join(' < ')}`).toEqual(order);
      // The light theme block must also precede every theme's accent blocks
      // (same (0,2,0) specificity as an accent block, resolved by source order).
      expect(inL1b(`.light[data-theme="${theme.id}"]`)).toBeLessThan(inL1b(`[data-theme="${THEMES[0]!.id}"][data-accent="${ACCENT_IDS.find((a) => a !== THEMES[0]!.defaultAccent)}"]`));
    }
  });

  it('accent blocks set only accent, on-accent and focus, and are always theme-scoped', () => {
    const names = DESIGN_ACCENT_KEYS.map((k) => DESIGN_COLOR_VARS.find(([key]) => key === k)![1]);
    for (const theme of THEMES) {
      for (const accentId of ACCENT_IDS) {
        if (accentId === theme.defaultAccent) continue;
        const body = block(`[data-theme="${theme.id}"][data-accent="${accentId}"]`);
        const declared = [...body.matchAll(/(--gai-[\w-]+):/g)].map((m) => m[1]);
        expect(declared, `${theme.id}/${accentId}`).toEqual(names);
      }
    }
    expect(l1b.match(/^(?:\.light)?\[data-accent=/gm)).toBeNull();
  });

  it('emits ink accent blocks for all 17 themes whose default is not ink', () => {
    const others = THEMES.filter((t) => t.defaultAccent !== 'ink');
    expect(others).toHaveLength(17);
    for (const theme of others) expect(at(`[data-theme="${theme.id}"][data-accent="ink"]`), theme.id).toBeGreaterThan(-1);
  });

  it('maps only the font families in Layer 2; colours live in vocabulary.css', () => {
    const bridge = css.slice(css.indexOf('@theme inline {'), css.indexOf('}', css.indexOf('@theme inline {')));
    expect(bridge).toContain('--font-sans: var(--font-sans);');
    expect(bridge).not.toContain('--color-');
  });

  it('safelists the required design utilities for the CSS-emission check', () => {
    expect(css).toContain(`@source inline("${REQUIRED_UTILITIES.join(' ')}");`);
  });
});

describe('design scales (L1c)', () => {
  const blockOf = (selector: string): string => {
    const i = css.indexOf(`\n${selector} {`);
    expect(i, `${selector} missing`).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };
  const declared = (body: string): string[] => [...body.matchAll(/^\s+(--[\w-]+):/gm)].map((m) => m[1]!);

  it('defaults sit on :root, after the design colour layer', () => {
    const start = css.indexOf('Layer 1c');
    expect(start).toBeGreaterThan(css.indexOf(DESIGN_LAYER_HEADER));
    const root = css.slice(css.indexOf(':root {', start), css.indexOf('}', css.indexOf(':root {', start)));
    for (const name of ['--gai-h-row: 44px', '--gai-h-control: 28px', '--gai-text-ui: 13px', '--gai-leading-body: 1.6',
      '--gai-weight-title: 600', '--gai-tracking-heading: -0.01em', '--gai-duration-fast: 120ms',
      '--gai-ease-standard: cubic-bezier(0.2, 0, 0, 1)', '--gai-z-dialog: 1000', '--gai-z-dropdown: 1100', '--gai-w-sidebar: 232px']) {
      expect(root, name).toContain(`  ${name};`);
    }
  });

  it('16: density and font size never touch colour — each axis block declares only its own variables', () => {
    const compact = declared(blockOf('[data-density="compact"]'));
    expect(compact.length).toBeGreaterThan(0);
    for (const name of compact) expect(name).toMatch(/^--gai-h-/);
    for (const size of ['12', '14']) {
      const names = declared(blockOf(`[data-font-size="${size}"]`));
      expect(names.length).toBe(7);
      for (const name of names) expect(name).toMatch(/^--gai-(?:text|leading)-/);
    }
    for (const name of declared(blockOf('[data-motion="reduce"]'))) expect(name).toMatch(/^--gai-duration-/);
    expect(blockOf('[data-density="compact"]')).toContain('--gai-h-row: 36px;');
    expect(blockOf('[data-font-size="12"]')).toContain('--gai-text-ui: 12px;');
    expect(blockOf('[data-font-size="14"]')).toContain('--gai-text-display: 29px;');
    expect(blockOf('[data-motion="reduce"]')).toContain('--gai-duration-fast: 0ms;');
  });

  it('gives every theme its derived radius scale (D-14)', () => {
    const l1b = css.slice(css.indexOf(DESIGN_LAYER_HEADER));
    for (const theme of THEMES) {
      const i = l1b.indexOf(`\n[data-theme="${theme.id}"] {`);
      const body = l1b.slice(i, l1b.indexOf('}', i));
      expect(body, theme.id).toContain(`--gai-radius-card: ${Math.max(2, theme.radius.DEFAULT + 2)}px;`);
      expect(body, theme.id).toContain('--gai-radius-dialog:');
    }
    expect(l1b).toContain('--gai-radius-badge: 4px;'); // :root = Instrument
  });
});

describe('shared class vocabulary', () => {
  const vocab = emitVocabularyCss();

  it('maps every design colour name to its --gai-* variable', () => {
    for (const name of COLOR_NAMES) expect(vocab).toContain(`  --color-${name}: var(--gai-${name});`);
    for (const [name, variable] of Object.entries(TEXT_COLOR_OVERRIDES)) {
      expect(vocab).toContain(`  --text-color-${name}: var(--gai-${variable});`);
    }
    expect(vocab).toContain('  --shadow-pop: var(--gai-shadow-pop);');
    expect(vocab).toContain('  --text-title--font-weight: var(--gai-weight-title);');
    expect(vocab).toContain('  --text-heading--letter-spacing: var(--gai-tracking-heading);');
    expect(vocab).not.toContain('--text-ui--font-weight');
    expect(vocab).toContain('  --radius-card: var(--gai-radius-card);');
    expect(vocab).toContain('  --height-row: var(--gai-h-row);');
    expect(vocab).toContain('  --size-control: var(--gai-h-control);');
    expect(vocab).toContain('  --z-index-dialog: var(--gai-z-dialog);');
    expect(vocab).toContain('  --container-sidebar: var(--gai-w-sidebar);');
    expect(vocab).toContain('  --ease-standard: var(--gai-ease-standard);');
    for (const name of SHARED_COLOR_NAMES) expect(vocab).toContain(`  --color-${name}: var(--${name});`);
  });

  it('holds names only, no values, so each platform supplies its own (D-40)', () => {
    expect(vocab).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(vocab).toContain('GENERATED');
  });

  it('has a web value behind every variable it maps to', () => {
    // Every var(--gai-*) the vocabulary reads must be declared by globals.css.
    for (const [, v] of vocab.matchAll(/var\((--gai-[\w-]+)\)/g)) expect(css, v).toContain(`  ${v}: `);
  });

  it('exports the lists Node tools read, identical to the TS source', () => {
    const json = JSON.parse(emitVocabularyJson());
    expect(json).toEqual(JSON.parse(JSON.stringify(vocabularyJson())));
    expect(json.requiredUtilities).toEqual([...REQUIRED_UTILITIES]);
    expect(json.legacyUtilityNames).toEqual([...LEGACY_UTILITY_NAMES]);
  });

  it('keeps legacy and design names disjoint', () => {
    const design = new Set<string>([...COLOR_NAMES, ...SHARED_COLOR_NAMES]);
    for (const name of LEGACY_UTILITY_NAMES) expect(design.has(name), name).toBe(false);
  });
});

describe('splice', () => {
  it('replaces only the region between the markers', () => {
    const file = `HEAD\n${TOKENS_START_MARKER}\nold\n${TOKENS_END_MARKER}\nTAIL`;
    const out = spliceCss(file, 'new');
    expect(out.startsWith('HEAD')).toBe(true);
    expect(out.endsWith('TAIL')).toBe(true);
    expect(out).toContain('new');
    expect(out).not.toContain('old');
  });

  it('refuses to guess when the markers are missing', () => {
    // Silently appending would corrupt the hand-written base styles below.
    expect(() => spliceCss('no markers here', 'new')).toThrow(/markers/);
  });
});

describe('native emitter', () => {
  const native = emitNative();

  it('exports one variable bag per theme × appearance × accent', () => {
    for (const theme of THEMES) {
      expect(native, `${theme.id} missing from mobile bundle`).toContain(`"${theme.id}"`);
    }
    // Mobile resolves `var()` at style time but needs literals for Skia and
    // the status bar, so the values must be concrete.
    expect(native).toContain('"--background"');
    expect(native).toContain('"--chart-1"');
    // The design layer ships as literals too (M-01), but gets no NativeWind
    // utilities in P1.
    expect(native).toContain('"--gai-ground"');
    const tailwind = native.slice(native.indexOf('export const tailwindColors'), native.indexOf('/** Design-layer colour names'));
    expect(tailwind).not.toContain('gai-');
    expect(native).toContain('export const gaiColors');
    expect(native).toContain('export const accentIds');
  });

  it('ships terminal palettes and picker metadata', () => {
    expect(native).toContain('terminalThemes');
    expect(native).toContain('themeMeta');
    expect(native).toContain('brightMagenta');
  });

  it('is marked generated so an edit is caught rather than absorbed', () => {
    expect(native).toContain('GENERATED FILE — do not edit');
  });
});

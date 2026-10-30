// Uniwind theme emitter (mobile 02 §9.2 tests 1–6).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { accentTokens, accentVars, toAccentVars } from '../../accent.js';
import { DESIGN_COLOR_VARS, resolveDesignTokens } from '../../design.js';
import { GEOMETRY } from '../../geometry.js';
import { SHADOW_FLOAT } from '../../glass.js';
import { THEMES } from '../../themes/index.js';
import { ACCENT_IDS, resolveChartRamp, type Appearance } from '../../themes/types.js';
import { buildNativePalette } from '../../native-palette.js';
import {
  UNIWIND_THEMES,
  emitNativePalette,
  emitNativePaletteIndex,
  emitSplashColors,
  emitUniwindThemeList,
  emitUniwindThemes,
  uniwindColorVars,
  uniwindGeometryVars,
  uniwindThemeName,
} from '../uniwind.js';
import { emitMobileVocabularyCss, emitVocabularyCss } from '../vocabulary.js';

const APPEARANCES: Appearance[] = ['dark', 'light'];
const css = emitUniwindThemes();

/** `@variant <name> { --k: v; … }` blocks of the emitted file. */
function variants(text: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const m of text.matchAll(/@variant ([\w-]+) \{\n([^}]*)\n {4}\}/g)) {
    out.set(m[1]!, Object.fromEntries([...m[2]!.matchAll(/^\s+(--[\w-]+): (.+);$/gm)].map((d) => [d[1]!, d[2]!])));
  }
  return out;
}
const blocks = variants(css);

describe('UNIWIND_THEMES', () => {
  it('lists 36 unique names = THEMES × [dark, light], in order', () => {
    expect(UNIWIND_THEMES).toHaveLength(36);
    expect(new Set(UNIWIND_THEMES).size).toBe(36);
    expect(UNIWIND_THEMES).toEqual(THEMES.flatMap((t) => [`${t.id}-dark`, `${t.id}-light`]));
    expect(uniwindThemeName('nord', 'light')).toBe('nord-light');
    expect(JSON.parse(emitUniwindThemeList())).toEqual(UNIWIND_THEMES);
  });
});

describe('uniwind-themes.css', () => {
  it('has the light/dark defaults, 36 theme blocks and the two platform blocks, nothing else', () => {
    expect([...blocks.keys()]).toEqual(['dark', 'light', ...UNIWIND_THEMES, 'ios', 'android']);
  });

  it('declares the same 41 colour keys in every colour block; light/dark equal Instrument', () => {
    const keys = Object.keys(blocks.get('dark')!);
    expect(keys).toHaveLength(41);
    for (const name of ['light', ...UNIWIND_THEMES]) expect(Object.keys(blocks.get(name)!), name).toEqual(keys);
    expect(blocks.get('dark')).toEqual(blocks.get('instrument-dark'));
    expect(blocks.get('light')).toEqual(blocks.get('instrument-light'));
  });

  it('declares the same geometry keys on both platforms, covering every variable the vocabularies read', () => {
    const ios = blocks.get('ios')!;
    const android = blocks.get('android')!;
    expect(Object.keys(android)).toEqual(Object.keys(ios));
    const defined = new Set([...Object.keys(ios), ...Object.keys(blocks.get('dark')!)]);
    const referenced = new Set(
      [emitVocabularyCss(), emitMobileVocabularyCss()].flatMap((v) => [...v.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!)),
    );
    const missing = [...referenced].filter((v) => !defined.has(v));
    expect(missing).toEqual([]);
  });

  it('carries the un-varianted iOS geometry for the web preview', () => {
    const root = css.slice(css.indexOf('/* Geometry.'), css.indexOf('@variant ios'));
    const decls = Object.fromEntries([...root.matchAll(/^ {4}(--[\w-]+): (.+);$/gm)].map((d) => [d[1]!, d[2]!]));
    expect(decls).toEqual(blocks.get('ios'));
  });

  it.each(THEMES.flatMap((t) => APPEARANCES.map((a) => [t.id, a, t] as const)))(
    '%s-%s equals resolveDesignTokens at the default accent (parity)',
    (id, appearance, theme) => {
      const block = blocks.get(`${id}-${appearance}`)!;
      const d = resolveDesignTokens(theme, appearance, theme.defaultAccent);
      for (const [key, name] of DESIGN_COLOR_VARS) expect(block[name], name).toBe(d[key]);
      resolveChartRamp(theme, appearance).forEach((c, i) => expect(block[`--chart-${i + 1}`]).toBe(c));
      expect(block['--gai-shadow-float']).toBe(SHADOW_FLOAT);
      expect(block).toEqual(uniwindColorVars(theme, appearance));
    },
  );

  it.each(['ios', 'android'] as const)('%s geometry equals GEOMETRY.%s (parity)', (platform) => {
    const g = GEOMETRY[platform];
    const block = blocks.get(platform)!;
    expect(block).toEqual(uniwindGeometryVars(platform));
    expect(block['--gai-text-body']).toBe(`${g.type.body.size}px`);
    expect(block['--gai-leading-display']).toBe(`${g.type.display.lineHeight}px`);
    expect(block['--gai-tracking-display']).toBe(`${g.type.display.tracking}px`);
    expect(block['--gai-weight-micro']).toBe('500');
    expect(block['--gai-radius-card']).toBe(`${g.radii.card}px`);
    expect(block['--gai-h-row']).toBe(`${g.heights.comfortable.row}px`);
    expect(block['--gai-h-badge-sm']).toBe('20px');
    expect(block['--gai-w-drawer']).toBe(`${g.mobileShell.drawer}px`);
    expect(block['--gai-z-dialog']).toBe('1000');
  });

  it('pins the board values that differ per platform', () => {
    expect([blocks.get('ios')!['--gai-text-body'], blocks.get('android')!['--gai-text-body']]).toEqual(['17px', '16px']);
    expect([blocks.get('ios')!['--gai-radius-card'], blocks.get('android')!['--gai-radius-card']]).toEqual(['14px', '12px']);
  });

  it('holds literals only: no rem, em, %, calc() or color-mix()', () => {
    const values = [...blocks.values()].flatMap((b) => Object.values(b));
    for (const v of values) {
      expect(v, v).not.toMatch(/\d(?:rem|em|%)\b|calc\(|color-mix\(|var\(/);
    }
  });

  it('is deterministic', () => {
    expect(emitUniwindThemes()).toBe(css);
    expect(emitUniwindThemeList()).toBe(emitUniwindThemeList());
  });

  // The host app is an optional generator target (bin/generate.ts); check:tokens guards it in CI too.
  const themeDir = fileURLToPath(new URL('../../../../../apps/mobile/src/theme/', import.meta.url));
  it.skipIf(!existsSync(themeDir))('matches the checked-in apps/mobile files', () => {
    const read = (name: string): string => readFileSync(`${themeDir}${name}`, 'utf8').replace(/\r\n/g, '\n');
    expect(read('uniwind-themes.css')).toBe(css);
    expect(read('uniwind-themes.json')).toBe(emitUniwindThemeList());
  });
});

describe('accentVars (Uniwind.updateCSSVariables input)', () => {
  it('equals the design layer for every theme × appearance × accent, and the default accent equals the block', () => {
    for (const theme of THEMES) {
      for (const appearance of APPEARANCES) {
        for (const id of ACCENT_IDS) {
          const d = resolveDesignTokens(theme, appearance, id);
          expect(accentVars(theme, appearance, id)).toEqual({
            '--gai-accent': d.accent,
            '--gai-on-accent': d.onAccent,
            '--gai-focus': d.focus,
          });
          expect(accentVars(theme, appearance, id)).toEqual(toAccentVars(accentTokens(theme, appearance, id)));
        }
        const block = blocks.get(`${theme.id}-${appearance}`)!;
        const def = accentVars(theme, appearance, theme.defaultAccent);
        for (const [k, v] of Object.entries(def)) expect(block[k]).toBe(v);
      }
    }
  });
});

describe('native palettes (02 §9.3)', () => {
  it('carry each theme at its default accent plus the seven accent triples, equal to accentVars', () => {
    for (const theme of THEMES) {
      const p = buildNativePalette(theme);
      expect(p.id).toBe(theme.id);
      for (const appearance of APPEARANCES) {
        expect(p[appearance].tokens).toEqual(resolveDesignTokens(theme, appearance, theme.defaultAccent));
        expect(p[appearance].chart).toEqual(resolveChartRamp(theme, appearance));
        for (const id of ACCENT_IDS) {
          expect(toAccentVars(p.accents[appearance][id])).toEqual(accentVars(theme, appearance, id));
        }
      }
    }
  });

  it('emit one module per theme, a require-switch index and the splash colours', () => {
    expect(emitNativePalette('nord')).toContain('id: "nord"');
    const index = emitNativePaletteIndex();
    for (const theme of THEMES) expect(index).toContain(`require('./${theme.id}')`);
    expect(JSON.parse(emitSplashColors())).toEqual({ light: { background: '#ffffff' }, dark: { background: '#111113' } });
  });

  it('stay small: accent deltas only, never a bag per accent', () => {
    const total = THEMES.reduce((n, t) => n + emitNativePalette(t.id).length, 0);
    expect(total).toBeLessThan(90_000);
  });
});

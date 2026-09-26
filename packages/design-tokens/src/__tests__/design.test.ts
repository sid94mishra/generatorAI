// ────────────────────────────────────────────────────────────────
// WCAG suite for the design layer (02 §12, 09 §2.6; D-11, D-12).
//
// 18 themes × 2 appearances × 7 accents = 252 combinations. Accent-independent
// assertions run once per theme × appearance (36); accent ones run on all 252.
// Every failure names the combination, the token, the backdrop and the ratio.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { contrastRatio, flatten, parseHex, relativeLuminance, type Rgba } from '../color.js';
import { DESIGN_ACCENT_KEYS, DESIGN_COLOR_VARS, resolveDesignTokens, type DesignTokens } from '../design.js';
import { ACCENT_IDS, THEMES, type Appearance, type ThemeDef } from '../themes/index.js';

const APPEARANCES: Appearance[] = ['dark', 'light'];

interface Case {
  theme: ThemeDef;
  appearance: Appearance;
  label: string;
  min: number;
  tokens: DesignTokens;
}

/** One entry per theme × appearance, on the theme's default accent. */
const MATRIX2: Case[] = THEMES.flatMap((theme) =>
  APPEARANCES.map((appearance) => ({
    theme,
    appearance,
    label: `${theme.id}/${appearance}`,
    min: theme.textContrast ?? 4.5,
    tokens: resolveDesignTokens(theme, appearance, theme.defaultAccent),
  })),
);

/** All 252 combinations. */
const MATRIX7: Array<Case & { accent: string }> = THEMES.flatMap((theme) =>
  APPEARANCES.flatMap((appearance) =>
    ACCENT_IDS.map((accent) => ({
      theme,
      appearance,
      accent,
      label: `${theme.id}/${appearance}/${accent}`,
      min: theme.textContrast ?? 4.5,
      tokens: resolveDesignTokens(theme, appearance, accent),
    })),
  ),
);

const fmt = (c: string | Rgba): string =>
  typeof c === 'string' ? c : `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Assert `colour` clears `min` on every named backdrop; the message names the failing pair. */
function expectOn(label: string, token: string, colour: string, backs: Record<string, string | Rgba>, min: number): void {
  for (const [name, back] of Object.entries(backs)) {
    const ratio = contrastRatio(colour, back);
    expect(ratio, `${label}/${token} ${colour} on ${name} ${fmt(back)} → ${ratio.toFixed(2)}:1 (needs ${min})`).toBeGreaterThanOrEqual(min);
  }
}

const textBacks = (t: DesignTokens): Record<string, string | Rgba> => ({
  ground: t.ground,
  surface: t.surface,
  raised: t.raised,
  overlay: t.overlay,
  sunken: t.sunken,
  'hover∘surface': flatten(t.hover, t.surface),
  'hover∘ground': flatten(t.hover, t.ground),
  'selected∘surface': flatten(t.selected, t.surface),
  'selected∘ground': flatten(t.selected, t.ground),
});
const fourSurfaces = (t: DesignTokens): Record<string, string> => ({
  ground: t.ground,
  surface: t.surface,
  raised: t.raised,
  overlay: t.overlay,
});
/** The four plus `sunken`, where inputs sit (and take the focus ring and status text). */
const fiveSurfaces = (t: DesignTokens): Record<string, string> => ({ ...fourSurfaces(t), sunken: t.sunken });

describe('design layer — WCAG suite (252 combinations)', () => {
  it('covers 18 themes × 2 appearances × 7 accents', () => {
    expect(THEMES).toHaveLength(18);
    expect(ACCENT_IDS).toHaveLength(7);
    expect(MATRIX7).toHaveLength(252);
  });

  it('1: fg, fg-2 and fg-3 clear the text bar on every surface and on hovered/selected rows', () => {
    for (const { label, min, tokens: t } of MATRIX2) {
      for (const token of ['fg', 'fg2', 'fg3'] as const) expectOn(label, token, t[token], textBacks(t), min);
    }
  });

  it('2: instrument dark fg-3 clears 4.5 on overlay (the board 4.30 case, D-12)', () => {
    const t = MATRIX2.find((c) => c.label === 'instrument/dark')!.tokens;
    expect(contrastRatio(t.fg3, t.overlay)).toBeGreaterThanOrEqual(4.5);
  });

  it('3: text tiers are ordered fg-3 ≤ fg-2 ≤ fg on surface', () => {
    for (const { label, tokens: t } of MATRIX2) {
      const [c3, c2, c1] = [t.fg3, t.fg2, t.fg].map((c) => contrastRatio(c, t.surface)) as [number, number, number];
      expect(c3, `${label}: fg-3 ${c3.toFixed(2)} > fg-2 ${c2.toFixed(2)}`).toBeLessThanOrEqual(c2);
      expect(c2, `${label}: fg-2 ${c2.toFixed(2)} > fg ${c1.toFixed(2)}`).toBeLessThanOrEqual(c1);
    }
  });

  it('4: line-strong clears 3:1 on all five surfaces (checkbox, switch, input edges)', () => {
    for (const { label, tokens: t } of MATRIX2) {
      expectOn(label, 'line-strong', t.lineStrong, { ...fourSurfaces(t), sunken: t.sunken }, 3);
    }
  });

  it('5: line clears 1.2:1 on ground, surface and overlay (dividers)', () => {
    for (const { label, tokens: t } of MATRIX2) {
      expectOn(label, 'line', t.line, { ground: t.ground, surface: t.surface, overlay: t.overlay }, 1.2);
    }
  });

  it('6: status hues clear 3:1 on ground, surface, raised and overlay', () => {
    for (const { label, tokens: t } of MATRIX2) {
      for (const token of ['run', 'ok', 'warn', 'err'] as const) expectOn(label, token, t[token], fourSurfaces(t), 3);
    }
  });

  it('7: status text clears the text bar on its own tint (also in hovered/selected rows) and on every surface, sunken included', () => {
    for (const { label, min, tokens: t } of MATRIX2) {
      for (const state of ['run', 'ok', 'warn', 'err'] as const) {
        const bg = t[`${state}Bg`];
        expectOn(
          label,
          `${state}-text`,
          t[`${state}Text`],
          {
            [`${state}-bg∘surface`]: flatten(bg, t.surface),
            [`${state}-bg∘ground`]: flatten(bg, t.ground),
            [`${state}-bg∘raised`]: flatten(bg, t.raised),
            // A status badge in a selected / hovered table row (P3-02, axe).
            [`${state}-bg∘selected∘surface`]: flatten(bg, flatten(t.selected, t.surface)),
            [`${state}-bg∘selected∘ground`]: flatten(bg, flatten(t.selected, t.ground)),
            [`${state}-bg∘hover∘surface`]: flatten(bg, flatten(t.hover, t.surface)),
            ...fiveSurfaces(t),
          },
          min,
        );
      }
    }
  });

  it('8: status hues stay distinguishable from each other', () => {
    // Same metric as the legacy suite (tokens.test.ts), on the clamped hues.
    const pairs = [
      ['ok', 'err'],
      ['ok', 'warn'],
      ['warn', 'err'],
      ['run', 'ok'],
      ['run', 'err'],
    ] as const;
    for (const { label, tokens: t } of MATRIX2) {
      for (const [a, b] of pairs) {
        const ca = parseHex(t[a]);
        const cb = parseHex(t[b]);
        const dist = Math.abs(relativeLuminance(ca) - relativeLuminance(cb));
        const apart = Math.abs(ca.r - cb.r) + Math.abs(ca.g - cb.g) + Math.abs(ca.b - cb.b);
        expect(dist + apart / 255, `${label}: ${a} ${t[a]} vs ${b} ${t[b]}`).toBeGreaterThan(0.35);
      }
    }
  });

  it('9: on-accent on accent clears 4.5:1 (all 252)', () => {
    for (const { label, tokens: t } of MATRIX7) expectOn(label, 'on-accent', t.onAccent, { accent: t.accent }, 4.5);
  });

  it('10: focus clears 3:1 on ground, surface, raised, overlay and sunken (all 252)', () => {
    for (const { label, tokens: t } of MATRIX7) expectOn(label, 'focus', t.focus, fiveSurfaces(t), 3);
  });

  it('11: ink is the foreground, with surface-coloured text and a foreground focus ring', () => {
    for (const { theme, appearance, label } of MATRIX2) {
      const t = resolveDesignTokens(theme, appearance, 'ink');
      expect(t.accent, `${label}/ink accent`).toBe(t.fg);
      expect(t.onAccent, `${label}/ink on-accent`).toBe(t.surface);
      expect(t.focus, `${label}/ink focus`).toBe(t.fg);
    }
  });

  it('12: fg clears the text bar on diff add/del rows', () => {
    for (const { label, min, tokens: t } of MATRIX2) {
      expectOn(label, 'fg', t.fg, { 'add-bg∘surface': flatten(t.addBg, t.surface), 'del-bg∘surface': flatten(t.delBg, t.surface) }, min);
    }
  });

  it('12b: the scrim dims the page behind a dialog, and the dialog does not let it through', () => {
    // Row 1 measures text on `overlay` alone. That is what the reader sees only
    // because overlay is opaque; a translucent overlay would mix in the scrim.
    for (const { label, tokens: t } of MATRIX2) {
      const scrim = parseHex(t.scrim);
      const dimmed = flatten(t.scrim, t.surface);
      expect(parseHex(t.overlay).a, `${label}: overlay ${t.overlay} must be opaque`).toBe(1);
      expect(scrim.a, `${label}: scrim ${t.scrim} must be translucent`).toBeGreaterThan(0);
      expect(scrim.a, `${label}: scrim ${t.scrim} must be translucent`).toBeLessThan(1);
      expect(
        relativeLuminance(dimmed),
        `${label}: scrim ${t.scrim} over surface ${t.surface} → ${fmt(dimmed)} must be darker`,
      ).toBeLessThan(relativeLuminance(parseHex(t.surface)));
    }
  });

  it('13: High Contrast holds 7:1 for text tiers and status text', () => {
    for (const { label, min, tokens: t, theme } of MATRIX2) {
      if (theme.id !== 'contrast') continue;
      expect(min).toBe(7);
      for (const token of ['fg', 'fg2', 'fg3'] as const) expectOn(label, token, t[token], textBacks(t), 7);
      for (const token of ['runText', 'okText', 'warnText', 'errText'] as const) expectOn(label, token, t[token], fiveSurfaces(t), 7);
    }
  });

  it('14: Instrument reproduces the board surfaces and the 02 §2.3 derived values', () => {
    const dark = resolveDesignTokens(THEMES.find((t) => t.id === 'instrument')!, 'dark', 'ink');
    expect(dark).toMatchObject({
      ground: '#0b0b0c', surface: '#111113', raised: '#17171a', overlay: '#1d1d21', sunken: '#0d0d0f',
      hover: '#ededef0a', selected: '#ededef14', lineSoft: '#1c1c20', line: '#2c2c31', lineStrong: '#68686c',
      fg: '#ededef', fg2: '#a1a1aa', fg3: '#898991', accent: '#ededef', onAccent: '#111113', focus: '#ededef',
      run: '#6aa6ff', runText: '#6aa6ff', runBg: '#6aa6ff26', ok: '#4cc38a', okText: '#4cc38a', okBg: '#4cc38a26',
      warn: '#f0b429', warnText: '#f0b429', warnBg: '#f0b42926', err: '#ff6369', errText: '#fe696e', errBg: '#ff636926',
      addBg: '#4cc38a1a', delBg: '#ff63691a', scrim: '#0000009e',
      shadowPop: '0 16px 40px #0000008c, 0 0 0 1px #ededef0f',
    });
    const light = resolveDesignTokens(THEMES.find((t) => t.id === 'instrument')!, 'light', 'ink');
    expect(light).toMatchObject({
      ground: '#f1f1ef', surface: '#ffffff', raised: '#fafaf9', overlay: '#ffffff', sunken: '#f6f6f4',
      hover: '#18181b0a', selected: '#18181b14', lineSoft: '#ecece9', line: '#dcdcd7', lineStrong: '#8a8a88',
      fg: '#18181b', fg2: '#55555d', fg3: '#63636a', accent: '#18181b', onAccent: '#ffffff', focus: '#18181b',
      run: '#1d6ae5', runText: '#1b55b1', runBg: '#1d6ae520', ok: '#16804c', okText: '#166640', okBg: '#16804c20',
      warn: '#935f00', warnText: '#795006', warnBg: '#935f0020', err: '#d1242f', errText: '#a7222b', errBg: '#d1242f20',
      addBg: '#16804c14', delBg: '#d1242f14', scrim: '#1414184d',
      shadowPop: '0 16px 40px #14141e24, 0 0 0 1px #18181b0f',
    });
  });
});

describe('design layer — shape', () => {
  it('maps every DesignTokens key to exactly one --gai-* variable', () => {
    const keys = Object.keys(resolveDesignTokens(THEMES[0]!, 'dark', 'ink')).sort();
    expect(DESIGN_COLOR_VARS.map(([k]) => k).sort()).toEqual(keys);
    const names = DESIGN_COLOR_VARS.map(([, n]) => n);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^--gai-[a-z0-9-]+$/);
  });

  it('changes only accent, on-accent and focus between accents', () => {
    for (const theme of THEMES) {
      for (const appearance of APPEARANCES) {
        const base = resolveDesignTokens(theme, appearance, theme.defaultAccent);
        for (const accent of ACCENT_IDS) {
          const t = resolveDesignTokens(theme, appearance, accent);
          for (const [key] of DESIGN_COLOR_VARS) {
            if ((DESIGN_ACCENT_KEYS as readonly string[]).includes(key)) continue;
            expect(t[key], `${theme.id}/${appearance}/${accent}: ${key}`).toBe(base[key]);
          }
        }
      }
    }
  });

  it('never changes a legacy token (D-06): ground/surface/line come straight from the spec', () => {
    for (const { theme, appearance, label, tokens: t } of MATRIX2) {
      const s = theme[appearance];
      expect([s.background, s.card], label).toContain(t.ground);
      expect([s.background, s.card], label).toContain(t.surface);
      expect(t.line, label).toBe(s.border);
      expect(t.lineSoft, label).toBe(s.borderMuted);
      expect(t.fg, label).toBe(s.foreground);
    }
  });
});

// Design-layer colour primitives (02 §2.1, §12 "color.test.ts additions").
// The older utilities (parseHex, mix, ensureContrast …) are covered in
// tokens.test.ts.

import { describe, expect, it } from 'vitest';

import { contrastRatio, ensureContrastAll, oklabMix, parseHex, toHex } from '../color.js';
import { TINT } from '../themes/types.js';

describe('oklabMix', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(toHex(oklabMix('#1d6ae5', '#ffffff', 0))).toBe('#1d6ae5');
    expect(toHex(oklabMix('#1d6ae5', '#ffffff', 1))).toBe('#ffffff');
  });

  it('puts the black/white midpoint at OKLab L = 0.5, not at sRGB 50 %', () => {
    // L 0.5 → linear 0.125 → sRGB 0.389 → 0x63. A linear sRGB mix gives #808080.
    expect(toHex(oklabMix('#000000', '#ffffff', 0.5))).toBe('#636363');
  });

  it('clamps the amount', () => {
    expect(toHex(oklabMix('#000000', '#ffffff', 2))).toBe('#ffffff');
    expect(toHex(oklabMix('#000000', '#ffffff', -1))).toBe('#000000');
  });

  it('returns an opaque colour that survives a hex round-trip unchanged', () => {
    for (const [a, b, t] of [
      ['#a1a1aa', '#111113', 0.15],
      ['#55555d', '#ffffff', 0.09],
      ['#ff6369', '#6aa6ff', 0.5],
    ] as const) {
      const c = oklabMix(a, b, t);
      expect(c.a).toBe(1);
      expect(parseHex(toHex(c))).toEqual(c);
    }
  });

  it('stays inside sRGB for saturated endpoints', () => {
    const c = oklabMix('#00ff00', '#ff00ff', 0.5);
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe('ensureContrastAll', () => {
  it('returns the input unchanged (and opaque) when it already clears every backdrop', () => {
    expect(toHex(ensureContrastAll('#ededef', ['#0b0b0c', '#111113', '#1d1d21'], 4.5, '#ededef'))).toBe('#ededef');
    expect(toHex(ensureContrastAll('#a1a1aa', ['#0b0b0c', '#111113'], 4.5, '#ededef'))).toBe('#a1a1aa');
  });

  it('always reaches the ratio on a set of three backdrops', () => {
    const cases: Array<{ colour: string; backs: string[]; toward: string; min: number }> = [
      { colour: '#27272c', backs: ['#0b0b0c', '#111113', '#1d1d21'], toward: '#ededef', min: 3 },
      { colour: '#e2e2de', backs: ['#ffffff', '#f1f1ef', '#fafaf9'], toward: '#18181b', min: 3 },
      { colour: '#1d6ae5', backs: ['#f1f1ef', '#ffffff', '#fafaf9'], toward: '#18181b', min: 4.5 },
      { colour: '#6272a4', backs: ['#282a36', '#21222c', '#343746'], toward: '#f8f8f2', min: 4.5 },
    ];
    for (const { colour, backs, toward, min } of cases) {
      const out = ensureContrastAll(colour, backs, min, toward);
      for (const back of backs) {
        expect(contrastRatio(out, back), `${colour} → ${toHex(out)} on ${back}`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it('moves only as far as it must', () => {
    const out = ensureContrastAll('#27272c', ['#0b0b0c', '#111113', '#1d1d21'], 3, '#ededef');
    // One step less must fail on at least one backdrop, or the loop overshot.
    const worst = Math.min(...['#0b0b0c', '#111113', '#1d1d21'].map((b) => contrastRatio(out, b)));
    expect(worst).toBeGreaterThanOrEqual(3);
    expect(worst).toBeLessThan(3.2);
  });

  it('falls back to the target when nothing short of it clears the bar', () => {
    expect(toHex(ensureContrastAll('#777777', ['#777777'], 21, '#ffffff'))).toBe('#ffffff');
  });
});

describe('TINT', () => {
  it('carries the design-layer washes (02 §2.1)', () => {
    expect(TINT.hover).toEqual({ dark: 4, light: 4 });
    expect(TINT.selected).toEqual({ dark: 8, light: 8 });
    expect(TINT.diff).toEqual({ dark: 10, light: 8 });
  });
});

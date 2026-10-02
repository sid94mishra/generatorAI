// MD-08 / mobile 02 §2.5: the System (Material You) accent is derived from a
// seed with exactly the named-accent contrast rules, and touches only the
// accent triple.

import { describe, expect, it } from 'vitest';

import { accentTokens, resolveAccentFromSeed, toAccentVars } from '../accent.js';
import { contrastRatio, toHex } from '../color.js';
import { resolveDesignTokens } from '../design.js';
import { THEMES } from '../themes/index.js';
import { ACCENT_IDS, themeAccents, type Appearance } from '../themes/types.js';

const APPEARANCES: Appearance[] = ['dark', 'light'];

/** OKLCH (L 0..1, C, h°) → sRGB hex, channels clamped to the gamut. */
function oklchHex(L: number, C: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const enc = (v: number): number => {
    const c = Math.max(0, Math.min(1, v));
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  };
  return toHex({
    r: enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  });
}

/** 72 seeds: 12 hues at 30° × OKLCH lightness 20/35/50/65/80/92 %. */
const SEEDS = Array.from({ length: 12 }, (_, i) => i * 30).flatMap((hue) =>
  [0.2, 0.35, 0.5, 0.65, 0.8, 0.92].map((L) => oklchHex(L, 0.12, hue)),
);

describe('resolveAccentFromSeed (MD-08)', () => {
  it('has 72 distinct seeds', () => {
    expect(new Set(SEEDS).size).toBe(72);
  });

  it.each(THEMES.flatMap((t) => APPEARANCES.map((a) => [t.id, a, t] as const)))(
    '%s-%s: every seed clears 4.5:1 text and 3:1 focus on all five surfaces',
    (_id, appearance, theme) => {
      const d = resolveDesignTokens(theme, appearance, theme.defaultAccent);
      const surfaces = [d.ground, d.surface, d.raised, d.overlay, d.sunken];
      for (const seed of SEEDS) {
        const t = resolveAccentFromSeed(theme, appearance, seed);
        for (const v of Object.values(t)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrastRatio(t.accent, t.onAccent), seed).toBeGreaterThanOrEqual(4.5);
        for (const s of surfaces) expect(contrastRatio(t.focus, s), `${seed} on ${s}`).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it('equals the named accent for every derived (non-authored) hue accent', () => {
    let compared = 0;
    for (const theme of THEMES) {
      const accents = themeAccents(theme);
      for (const appearance of APPEARANCES) {
        ACCENT_IDS.forEach((id, i) => {
          if (id === 'ink' || theme[appearance].accentEmphasis?.[id]) return;
          const hue = accents[i]![appearance].primary;
          expect(resolveAccentFromSeed(theme, appearance, hue), `${theme.id}-${appearance} ${id}`).toEqual(
            accentTokens(theme, appearance, id),
          );
          compared += 1;
        });
      }
    }
    expect(compared).toBeGreaterThan(150);
  });

  it('accepts #rgb and any case', () => {
    const theme = THEMES[0]!;
    expect(resolveAccentFromSeed(theme, 'dark', '#F0A')).toEqual(resolveAccentFromSeed(theme, 'dark', '#ff00aa'));
  });

  it.each(['blue', '#12', '', '#12345678', '#ggg'])('rejects %j with a RangeError', (bad) => {
    expect(() => resolveAccentFromSeed(THEMES[0]!, 'dark', bad)).toThrow(RangeError);
  });

  it('toAccentVars maps the triple onto the three --gai-* variables', () => {
    expect(toAccentVars({ accent: '#111111', onAccent: '#ffffff', focus: '#222222' })).toEqual({
      '--gai-accent': '#111111',
      '--gai-on-accent': '#ffffff',
      '--gai-focus': '#222222',
    });
  });
});

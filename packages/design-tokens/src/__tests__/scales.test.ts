// Scales (P1-T6): radius (D-14), type (D-13), heights + density (D-15),
// z-order (D-41), shell widths, and the per-platform geometry schema (M-04).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  HEIGHTS,
  MIN_HIT_TARGET,
  RADIUS_OFFSETS,
  CONTAINER_WIDTHS,
  TYPE_SCALE,
  Z_INDEX,
  radiusScale,
  typeSizes,
} from '../design.js';
import { GEOMETRY, PLATFORMS } from '../geometry.js';
import { FONT_SIZES } from '../registry.js';
import { THEMES } from '../themes/index.js';
import { CONTAINER_NAMES, HEIGHT_NAMES, RADIUS_STEPS, TEXT_STEPS, Z_NAMES } from '../vocabulary.js';
import {
  MOBILE_CONTAINER_NAMES,
  MOBILE_HEIGHT_NAMES,
  MOBILE_RADIUS_STEPS,
  MOBILE_SPACING_NAMES,
  MOBILE_TEXT_STEPS,
} from '../vocabulary-mobile.js';

describe('radius scale (D-14)', () => {
  it.each([
    [4, [2, 3, 4, 5, 6, 8, 10]],
    [6, [4, 5, 6, 7, 8, 10, 12]],
    [8, [6, 7, 8, 9, 10, 12, 14]],
    [10, [8, 9, 10, 11, 12, 14, 16]],
  ])('base %i → %j (02 §6.1 table)', (base, expected) => {
    expect(RADIUS_STEPS.map((s) => radiusScale(base)[s])).toEqual(expected);
  });

  it('clamps to 2px, or 0 for a square theme', () => {
    expect(radiusScale(2)).toMatchObject({ badge: 2, 'control-sm': 2, control: 2 });
    expect(Object.values(radiusScale(0))).toEqual([0, 0, 0, 1, 2, 4, 6]);
  });

  it('Instrument reproduces the drawn radii 4/5/6/7/8/10/12', () => {
    const instrument = THEMES.find((t) => t.id === 'instrument')!;
    expect(Object.values(radiusScale(instrument.radius.DEFAULT))).toEqual([4, 5, 6, 7, 8, 10, 12]);
  });

  it('every theme base is one of the tabled rows', () => {
    for (const theme of THEMES) expect([4, 6, 8, 10], theme.id).toContain(theme.radius.DEFAULT);
  });
});

describe('type scale (D-13)', () => {
  it('has seven steps at 11/12/13/14/16/20/28 with weights from 400/500/600 only', () => {
    expect(TEXT_STEPS.map((s) => TYPE_SCALE[s].size)).toEqual([11, 12, 13, 14, 16, 20, 28]);
    for (const step of TEXT_STEPS) expect([400, 500, 600]).toContain(TYPE_SCALE[step].weight);
    expect(TYPE_SCALE.title.weight).toBe(600);
    expect(TYPE_SCALE.ui.lineHeight).toBe(1.45);
    expect(TYPE_SCALE.body.lineHeight).toBe(1.6);
  });

  it('the interface font size shifts every step by −1 / 0 / +1 px', () => {
    for (const setting of FONT_SIZES) {
      const delta = Number(setting) - 13;
      for (const step of TEXT_STEPS) expect(typeSizes(setting)[step]).toBe(TYPE_SCALE[step].size + delta);
    }
  });
});

describe('heights and density (D-15)', () => {
  it('matches the 02 §6.3 table', () => {
    expect(HEIGHTS.comfortable).toMatchObject({ 'control-sm': 24, control: 28, 'control-lg': 32, nav: 30, row: 44, th: 32, tab: 36, bar: 44 });
    expect(HEIGHTS.compact).toMatchObject({ 'control-sm': 20, control: 24, 'control-lg': 28, nav: 26, row: 36, th: 28, tab: 32, bar: 44 });
  });

  it('compact shrinks rows and controls, never bars, badges or kbd', () => {
    // A meter track is a stroke and a tile is a media frame, not targets: both keep their size.
    const fixed = ['bar', 'badge', 'kbd', 'panel-bar', 'dialog-bar', 'footer', 'strip', 'meter', 'tile'];
    for (const name of HEIGHT_NAMES) {
      const drop = HEIGHTS.comfortable[name] - HEIGHTS.compact[name];
      if (fixed.includes(name)) expect(drop, name).toBe(0);
      else expect(drop, name).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps a 24px minimum hit target (WCAG 2.5.8)', () => {
    expect(MIN_HIT_TARGET).toBe(24);
  });
});

describe('z-index (D-41)', () => {
  it('stacks base < sticky < dock < rail = sidebar < dialog < dropdown = popover < toast < tooltip', () => {
    const z = Z_INDEX;
    expect(z.base).toBeLessThan(z.sticky);
    expect(z.sticky).toBeLessThan(z.dock);
    expect(z.dock).toBeLessThan(z.rail);
    expect(z.rail).toBe(z.sidebar);
    expect(z.sidebar).toBeLessThan(z.dialog);
    expect(z.dialog).toBeLessThan(z.dropdown);
    expect(z.dropdown).toBe(z.popover);
    expect(z.popover).toBeLessThan(z.toast);
    expect(z.toast).toBeLessThan(z.tooltip);
    // The legacy primitives' values, so old and new layers interleave correctly.
    expect([z.dialog, z.dropdown, z.tooltip]).toEqual([1000, 1100, 1200]);
    expect(Object.keys(z)).toEqual([...Z_NAMES]);
  });
});

describe('per-platform geometry (M-04)', () => {
  it('fills web from the emitted scales', () => {
    expect(Object.keys(GEOMETRY)).toEqual([...PLATFORMS]);
    expect(GEOMETRY.web).toEqual({
      type: TYPE_SCALE,
      radiusOffsets: RADIUS_OFFSETS,
      heights: HEIGHTS,
      minHitTarget: MIN_HIT_TARGET,
      zIndex: Z_INDEX,
      shell: CONTAINER_WIDTHS,
    });
  });

  const sorted = (xs: readonly string[]): string[] => [...xs].sort();
  const native = [
    ['ios', GEOMETRY.ios, 44, 11],
    ['android', GEOMETRY.android, 48, 12],
  ] as const;

  describe.each(native)('NativeGeometry %s (mobile 02 §3.8)', (_platform, g, target, minText) => {
    it('has exactly the keys of every name list', () => {
      expect(sorted(Object.keys(g.type))).toEqual(sorted([...TEXT_STEPS, ...MOBILE_TEXT_STEPS]));
      expect(sorted(Object.keys(g.radii))).toEqual(sorted([...RADIUS_STEPS, ...MOBILE_RADIUS_STEPS]));
      expect(sorted(Object.keys(g.heights.comfortable))).toEqual(sorted(HEIGHT_NAMES));
      expect(sorted(Object.keys(g.mobileHeights))).toEqual(sorted(MOBILE_HEIGHT_NAMES));
      expect(sorted(Object.keys(g.shell))).toEqual(sorted(CONTAINER_NAMES));
      expect(sorted(Object.keys(g.mobileShell))).toEqual(sorted(MOBILE_CONTAINER_NAMES));
      expect(sorted(Object.keys(g.panelMaxFraction))).toEqual(sorted(MOBILE_CONTAINER_NAMES));
      expect(sorted(Object.keys(g.spacing))).toEqual(sorted(MOBILE_SPACING_NAMES));
      expect(Object.keys(g.zIndex)).toEqual([...Z_NAMES]);
    });

    it('meets the MD-28 floors', () => {
      expect(g.minHitTarget).toBe(target);
      for (const [step, t] of Object.entries(g.type)) {
        expect(t.size, step).toBeGreaterThanOrEqual(minText);
        if (t.mono) expect(t.size, step).toBeGreaterThanOrEqual(12);
        expect([400, 500, 600], step).toContain(t.weight);
        expect(t.lineHeight, step).toBeGreaterThan(t.size);
      }
      for (const name of ['row', 'item', 'nav', 'step'] as const) {
        expect(g.heights.comfortable[name], name).toBeGreaterThanOrEqual(g.minHitTarget);
      }
      expect(g.heights.comfortable.th).toBeLessThan(g.minHitTarget); // a label, not interactive
      expect(g.mobileHeights.hit).toBe(g.minHitTarget);
      expect(g.mobileHeights['icon-button']).toBe(g.minHitTarget);
    });

    it('has one density (MD-69)', () => {
      expect(g.heights.comfortable).toEqual(g.heights.compact);
    });

    it('caps phone panels inside the window, drawer narrower than pane', () => {
      for (const f of Object.values(g.panelMaxFraction)) expect(f).toBeLessThanOrEqual(1);
      expect(g.mobileShell.drawer).toBeLessThan(g.mobileShell.pane);
      expect(g.breakpoints).toEqual({ medium: 600, expanded: 840 });
    });

    it('draws h-badge-sm at 20 for dense rows (MD-64)', () => {
      expect(g.mobileHeights['badge-sm']).toBe(20);
    });
  });

  it('pins the per-platform values of 02 §3.1–3.3', () => {
    expect(GEOMETRY.ios.type.body).toMatchObject({ size: 17, lineHeight: 24, ramp: 'body' });
    expect(GEOMETRY.android.type.body).toMatchObject({ size: 16, lineHeight: 24, m3: 'bodyLarge' });
    expect(GEOMETRY.ios.type.display).toMatchObject({ size: 32, lineHeight: 37, tracking: -0.64 });
    expect(GEOMETRY.android.type['detail-title']).toMatchObject({ size: 18, m3: null });
    expect([GEOMETRY.ios.radii.card, GEOMETRY.android.radii.card]).toEqual([14, 12]);
    expect([GEOMETRY.ios.heights.comfortable.control, GEOMETRY.android.heights.comfortable.control]).toEqual([44, 40]);
    expect([GEOMETRY.ios.heights.comfortable.row, GEOMETRY.android.heights.comfortable.row]).toEqual([52, 56]);
  });

  it('covers every shell width name', () => {
    expect(Object.keys(CONTAINER_WIDTHS)).toEqual([...CONTAINER_NAMES]);
    expect(CONTAINER_WIDTHS).toMatchObject({ sidebar: 232, rail: 48, dock: 480, 'dock-run': 440, sheet: 380, dialog: 640 });
  });

  it('takes every width from SHELL (chrome.ts): one source for the CSS vocabulary and the desktop', () => {
    const src = readFileSync(fileURLToPath(new URL('../design.ts', import.meta.url)), 'utf8');
    const block = /export const CONTAINER_WIDTHS = \{([^}]*)\}/.exec(src)?.[1] ?? '';
    const values = [...block.matchAll(/:\s*([^,\n]+),/g)].map((m) => m[1]!.trim());
    expect(values).toHaveLength(CONTAINER_NAMES.length);
    for (const v of values) expect(v).toMatch(/^SHELL\./);
  });
});

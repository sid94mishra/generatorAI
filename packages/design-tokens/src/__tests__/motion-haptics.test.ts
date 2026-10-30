// Mobile motion (02 §6.4, MD-76) and haptic (02 §7.1, MD-78) concepts.

import { describe, expect, it } from 'vitest';

import { ANDROID_MIN_API, HAPTICS, HAPTIC_CONCEPTS } from '../haptics.js';
import { MOTION_CONCEPTS, SPRINGS, type SpringSpec } from '../motion.js';

const r2 = (n: number): number => Math.round(n * 100) / 100;

describe('SPRINGS (02 §6.1)', () => {
  const all = Object.entries({ ...SPRINGS.ios, ...SPRINGS.m3 }) as Array<[string, SpringSpec]>;

  it.each(all)('%s never overshoots: ζ ∈ [0.85, 1]', (_name, s) => {
    const zeta = s.damping / (2 * Math.sqrt(s.stiffness));
    expect(zeta).toBeGreaterThanOrEqual(0.85 - 0.001);
    expect(zeta).toBeLessThanOrEqual(1 + 0.001);
  });

  it.each([
    ['smooth500', 0.5, 0],
    ['smooth350', 0.35, 0],
    ['smooth300', 0.3, 0],
    ['snappy350', 0.35, 0.15],
  ] as const)('ios.%s equals the SwiftUI formula', (name, duration, bounce) => {
    const stiffness = (2 * Math.PI / duration) ** 2;
    const damping = 2 * (1 - bounce) * Math.sqrt(stiffness);
    expect(SPRINGS.ios[name].stiffness).toBe(r2(stiffness));
    expect(SPRINGS.ios[name].damping).toBe(r2(damping));
  });

  it.each([
    ['spatialDefault', 0.9, 700],
    ['spatialFast', 0.9, 1400],
    ['spatialSlow', 0.9, 300],
    ['effectsDefault', 1, 1600],
    ['effectsFast', 1, 3800],
    ['effectsSlow', 1, 800],
  ] as const)('m3.%s equals the M3 standard scheme', (name, zeta, stiffness) => {
    expect(SPRINGS.m3[name].stiffness).toBe(stiffness);
    expect(SPRINGS.m3[name].damping).toBe(r2(2 * zeta * Math.sqrt(stiffness)));
  });

  it('covers every concept on both platforms; only press scales', () => {
    expect(Object.keys(MOTION_CONCEPTS).sort()).toEqual(
      ['listInsert', 'panel', 'press', 'reveal', 'sheet', 'spinner', 'swipe', 'toggle'],
    );
    for (const [name, spec] of Object.entries(MOTION_CONCEPTS)) {
      expect(spec.ios.spatial, name).toBeDefined();
      expect(spec.android.effects, name).toBeDefined();
      if (name !== 'press') expect(spec.pressScale, name).toBeUndefined();
    }
    expect(MOTION_CONCEPTS.press.android.spatial.kind).toBe('none'); // ripple, no scale
  });
});

describe('HAPTICS (02 §7.1)', () => {
  it.each(HAPTIC_CONCEPTS.map((c) => [c]))('%s has an iOS call and an Android chain ending at API ≤ minSdk', (concept) => {
    const spec = HAPTICS[concept];
    expect(spec.ios.kind).toBeTruthy();
    expect(spec.android.length).toBeGreaterThan(0);
    expect(spec.android.at(-1)!.minApi).toBeLessThanOrEqual(ANDROID_MIN_API);
    const apis = spec.android.map((e) => e.minApi);
    expect(apis).toEqual([...apis].sort((a, b) => b - a)); // newest first
  });

  it('maps exactly the concept list', () => {
    expect(Object.keys(HAPTICS)).toEqual([...HAPTIC_CONCEPTS]);
  });

  it('Android warning and error share Reject; iOS keeps them apart (MD-78)', () => {
    expect(HAPTICS.warning.android).toEqual(HAPTICS.error.android);
    expect(HAPTICS.warning.android[0]!.member).toBe('Reject');
    expect(HAPTICS.warning.ios).not.toEqual(HAPTICS.error.ios);
  });
});

import { describe, expect, it } from 'vitest';
import { gaugeFraction, gaugeGeometry, gaugeOffset } from './Gauge';

describe('gaugeGeometry', () => {
  it('draws r 6 in the 14px ring and r 7 in the 16px ring (stroke 2)', () => {
    expect(gaugeGeometry(14)).toMatchObject({ center: 7, radius: 6 });
    expect(gaugeGeometry(16)).toMatchObject({ center: 8, radius: 7 });
    expect(gaugeGeometry(14).circumference).toBeCloseTo(2 * Math.PI * 6);
  });
});

describe('gaugeFraction', () => {
  it.each([
    [42, 100, 0.42],
    [0, 100, 0],
    [100, 100, 1],
    [150, 100, 1],
    [-5, 100, 0],
    [5, 0, 0],
    [Number.NaN, 100, 0],
    [64_000, 128_000, 0.5],
  ])('%d of %d → %d', (value, max, expected) => {
    expect(gaugeFraction(value, max)).toBeCloseTo(expected);
  });
});

describe('gaugeOffset', () => {
  const { circumference } = gaugeGeometry(14);

  it('leaves the whole dash hidden at 0 and none at max', () => {
    expect(gaugeOffset(0, 100, circumference)).toBeCloseTo(circumference);
    expect(gaugeOffset(100, 100, circumference)).toBeCloseTo(0);
  });

  it('hides the unfilled share of the circumference', () => {
    expect(gaugeOffset(25, 100, circumference)).toBeCloseTo(circumference * 0.75);
  });
});

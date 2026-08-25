// Coordinate remapping for downscaled captures (X-14).
//
// `screenshotMaxEdge` shrinks the image the model looks at, and every
// coordinate-taking tool documents its arguments as "window-local
// screenshot-pixel". Those two facts together mean the numbers the model sends
// back are in the SMALLER space while the driver clicks in the larger one. This
// failure is silent: the click lands, on the wrong thing.

import { describe, expect, it } from 'vitest';

import { scalePointsToDriverSpace } from '../src/services/ComputerService.js';
import type { ActionRequest } from '../src/domain/ports/IComputerBridge.js';

const target = { by: 'focused' } as const;

describe('scalePointsToDriverSpace', () => {
  it('is identity at factor 1 and returns the SAME object', () => {
    const req: ActionRequest = { type: 'clickPoint', target, x: 100, y: 200 };
    expect(scalePointsToDriverSpace(req, 1)).toBe(req);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses to scale by a nonsense factor (%s)',
    (factor) => {
      const req: ActionRequest = { type: 'clickPoint', target, x: 100, y: 200 };
      expect(scalePointsToDriverSpace(req, factor)).toBe(req);
    },
  );

  it('scales a click point', () => {
    const out = scalePointsToDriverSpace(
      { type: 'clickPoint', target, x: 640, y: 360 },
      3,
    );
    expect(out).toMatchObject({ x: 1920, y: 1080 });
  });

  it('scales drag endpoints', () => {
    const out = scalePointsToDriverSpace(
      { type: 'drag', target, from: { x: 10, y: 20 }, to: { x: 30, y: 40 } },
      2,
    );
    expect(out).toMatchObject({ from: { x: 20, y: 40 }, to: { x: 60, y: 80 } });
  });

  it('scales scroll deltas as well as the origin — a delta is a distance in the same space', () => {
    const out = scalePointsToDriverSpace(
      { type: 'scroll', target, deltaX: 5, deltaY: -100, x: 50, y: 60 },
      2,
    );
    expect(out).toMatchObject({ deltaX: 10, deltaY: -200, x: 100, y: 120 });
  });

  it('leaves an absent scroll origin absent rather than inventing 0', () => {
    const out = scalePointsToDriverSpace(
      { type: 'scroll', target, deltaX: 0, deltaY: 10 },
      2,
    ) as Extract<ActionRequest, { type: 'scroll' }>;
    expect(out.x).toBeUndefined();
    expect(out.y).toBeUndefined();
  });

  it('scales the Chromium focus point on typeText', () => {
    const out = scalePointsToDriverSpace(
      { type: 'typeText', target, text: 'hi', focus: { x: 100, y: 50 } },
      2,
    );
    expect(out).toMatchObject({ focus: { x: 200, y: 100 }, text: 'hi' });
  });

  it('leaves a typeText with no focus point untouched', () => {
    const req: ActionRequest = { type: 'typeText', target, text: 'hi' };
    expect(scalePointsToDriverSpace(req, 2)).toBe(req);
  });

  it('does not touch element-index actions — they carry no pixels', () => {
    const req: ActionRequest = {
      type: 'click',
      snapshotId: 's1',
      elementIndex: 4,
    };
    expect(scalePointsToDriverSpace(req, 3)).toBe(req);
  });

  it('rounds to integers — the driver takes pixels, not fractions', () => {
    const out = scalePointsToDriverSpace(
      { type: 'clickPoint', target, x: 101, y: 203 },
      1.5,
    );
    expect(out).toMatchObject({ x: 152, y: 305 });
  });
});

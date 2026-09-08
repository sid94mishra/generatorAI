import { describe, expect, it } from 'vitest';

import { DISMISS_VELOCITY, detentOffsets, nearestDetent, rubberBand, snapDetent } from '../components/ui/sheetMath';

// A 852pt screen, sheet sized to the tallest of three detents.
const SCREEN = 852;
const DETENTS = [0.28, 0.6, 0.92];
const SHEET = SCREEN * 0.92;
const OFFSETS = detentOffsets(DETENTS, SCREEN, SHEET);

describe('detentOffsets', () => {
  it('puts the tallest detent at zero and the lowest at the largest offset', () => {
    expect(OFFSETS[2]).toBe(0);
    expect(OFFSETS[0]).toBeGreaterThan(OFFSETS[1]!);
    expect(OFFSETS[0]).toBeCloseTo(SHEET - SCREEN * 0.28, 5);
  });

  it('never returns a negative offset for a detent taller than the sheet', () => {
    expect(detentOffsets([0.5, 0.9], 800, 600)).toEqual([200, 0]);
  });
});

describe('snapDetent — dismissal', () => {
  it('dismisses on a fast downward flick from anywhere', () => {
    expect(snapDetent({ offset: 0, velocity: DISMISS_VELOCITY + 1, offsets: OFFSETS, sheetHeight: SHEET })).toEqual({
      kind: 'dismiss',
    });
  });

  it('dismisses when dragged well below the lowest detent', () => {
    const lowest = OFFSETS[0]!;
    expect(snapDetent({ offset: lowest + SHEET * 0.5, velocity: 0, offsets: OFFSETS, sheetHeight: SHEET })).toEqual({
      kind: 'dismiss',
    });
  });

  it('does not dismiss when dragged only a little below the lowest detent', () => {
    const lowest = OFFSETS[0]!;
    expect(snapDetent({ offset: lowest + 40, velocity: 0, offsets: OFFSETS, sheetHeight: SHEET })).toEqual({
      kind: 'snap',
      index: 0,
    });
  });

  it('never dismisses when moving upward, however far below it is', () => {
    const lowest = OFFSETS[0]!;
    expect(snapDetent({ offset: lowest + SHEET * 0.5, velocity: -600, offsets: OFFSETS, sheetHeight: SHEET })).toEqual({
      kind: 'snap',
      index: 0,
    });
  });

  it('a persistent sheet snaps back instead of dismissing', () => {
    expect(
      snapDetent({
        offset: SHEET,
        velocity: 2000,
        offsets: OFFSETS,
        sheetHeight: SHEET,
        persistent: true,
      }),
    ).toEqual({ kind: 'snap', index: 0 });
  });
});

describe('snapDetent — velocity-aware snapping', () => {
  it('a slow release lands on the nearest detent', () => {
    const between = (OFFSETS[1]! + OFFSETS[2]!) / 2 + 30; // slightly nearer the middle one
    expect(snapDetent({ offset: between, velocity: 0, offsets: OFFSETS, sheetHeight: SHEET })).toEqual({
      kind: 'snap',
      index: 1,
    });
  });

  it('an upward flick from the lowest detent reaches the next one, not back to itself', () => {
    const lowest = OFFSETS[0]!;
    // Barely moved, but flicked upward.
    expect(snapDetent({ offset: lowest - 10, velocity: -700, offsets: OFFSETS, sheetHeight: SHEET })).toEqual({
      kind: 'snap',
      index: 1,
    });
  });

  it('a downward flick from the tallest detent drops to the middle one', () => {
    expect(snapDetent({ offset: 12, velocity: 600, offsets: OFFSETS, sheetHeight: SHEET })).toEqual({
      kind: 'snap',
      index: 1,
    });
  });

  it('a downward flick that is too slow to dismiss but starts at the lowest stays there', () => {
    const lowest = OFFSETS[0]!;
    expect(snapDetent({ offset: lowest + 5, velocity: 500, offsets: OFFSETS, sheetHeight: SHEET })).toEqual({
      kind: 'snap',
      index: 0,
    });
  });

  it('an upward flick at the tallest detent stays at the tallest', () => {
    expect(snapDetent({ offset: -20, velocity: -900, offsets: OFFSETS, sheetHeight: SHEET })).toEqual({
      kind: 'snap',
      index: 2,
    });
  });

  it('a single-detent sheet always snaps to index 0 unless dismissed', () => {
    const single = detentOffsets([0.5], SCREEN, SCREEN * 0.5);
    expect(snapDetent({ offset: 30, velocity: -100, offsets: single, sheetHeight: SCREEN * 0.5 })).toEqual({
      kind: 'snap',
      index: 0,
    });
  });
});

describe('rubberBand', () => {
  it('resists upward over-drag and leaves downward drag alone', () => {
    expect(rubberBand(-100)).toBe(-25);
    expect(rubberBand(100)).toBe(100);
  });
});

describe('nearestDetent', () => {
  it('picks the closest offset', () => {
    expect(nearestDetent(OFFSETS[1]! + 5, OFFSETS)).toBe(1);
    expect(nearestDetent(1000, OFFSETS)).toBe(0);
    expect(nearestDetent(-50, OFFSETS)).toBe(2);
  });
});

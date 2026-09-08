import { describe, expect, it } from 'vitest';

import {
  EDGE_GUTTER,
  FLICK_VELOCITY,
  clampIndex,
  clampOffset,
  isEdgeTouch,
  mountedPages,
  pageOffset,
  pageProgress,
  settlePage,
} from '../components/ui/pagerMath';

const WIDTH = 393;
const COUNT = 4;

describe('isEdgeTouch', () => {
  it('reserves the leftmost gutter for the platform back gesture', () => {
    expect(isEdgeTouch(0)).toBe(true);
    expect(isEdgeTouch(EDGE_GUTTER - 1)).toBe(true);
    expect(isEdgeTouch(EDGE_GUTTER)).toBe(false);
    expect(isEdgeTouch(200)).toBe(false);
  });
});

describe('pageOffset / clampIndex / pageProgress', () => {
  it('rests page i at -i * width', () => {
    expect(pageOffset(0, WIDTH)).toBe(0);
    expect(pageOffset(2, WIDTH)).toBe(-2 * WIDTH);
  });

  it('clamps and rounds an index into range', () => {
    expect(clampIndex(-1, COUNT)).toBe(0);
    expect(clampIndex(9, COUNT)).toBe(3);
    expect(clampIndex(1.6, COUNT)).toBe(2);
    expect(clampIndex(2, 0)).toBe(0);
  });

  it('reports a continuous progress clamped to the track', () => {
    expect(pageProgress(0, WIDTH, COUNT)).toBe(0);
    expect(pageProgress(-WIDTH * 1.5, WIDTH, COUNT)).toBe(1.5);
    expect(pageProgress(50, WIDTH, COUNT)).toBe(0);
    expect(pageProgress(-WIDTH * 10, WIDTH, COUNT)).toBe(COUNT - 1);
    expect(pageProgress(-100, 0, COUNT)).toBe(0);
  });
});

describe('clampOffset', () => {
  it('lets in-range offsets through untouched', () => {
    expect(clampOffset(-WIDTH, WIDTH, COUNT)).toBe(-WIDTH);
  });

  it('applies resistance before the first page', () => {
    expect(clampOffset(100, WIDTH, COUNT)).toBeCloseTo(30, 5);
  });

  it('applies resistance past the last page', () => {
    const last = pageOffset(COUNT - 1, WIDTH);
    expect(clampOffset(last - 100, WIDTH, COUNT)).toBeCloseTo(last - 30, 5);
  });
});

describe('settlePage', () => {
  const at = (index: number) => pageOffset(index, WIDTH);

  it('stays put on a short slow drag', () => {
    expect(settlePage({ offset: at(1) - 60, velocity: 0, width: WIDTH, count: COUNT, from: 1 })).toBe(1);
  });

  it('turns forward once the finger crosses half a page', () => {
    expect(settlePage({ offset: at(1) - WIDTH * 0.55, velocity: 0, width: WIDTH, count: COUNT, from: 1 })).toBe(2);
  });

  it('turns backward once the finger crosses half a page the other way', () => {
    expect(settlePage({ offset: at(1) + WIDTH * 0.55, velocity: 0, width: WIDTH, count: COUNT, from: 1 })).toBe(0);
  });

  it('a fast flick turns the page even after a tiny drag', () => {
    expect(
      settlePage({ offset: at(1) - 8, velocity: -(FLICK_VELOCITY + 1), width: WIDTH, count: COUNT, from: 1 }),
    ).toBe(2);
    expect(settlePage({ offset: at(1) + 8, velocity: FLICK_VELOCITY + 1, width: WIDTH, count: COUNT, from: 1 })).toBe(
      0,
    );
  });

  it('never moves more than one page per gesture', () => {
    expect(settlePage({ offset: at(0) - WIDTH * 2.6, velocity: -3000, width: WIDTH, count: COUNT, from: 0 })).toBe(1);
  });

  it('clamps at the ends of the track', () => {
    expect(settlePage({ offset: 200, velocity: 2000, width: WIDTH, count: COUNT, from: 0 })).toBe(0);
    expect(
      settlePage({ offset: at(COUNT - 1) - 200, velocity: -2000, width: WIDTH, count: COUNT, from: COUNT - 1 }),
    ).toBe(COUNT - 1);
  });

  it('a flick against the drag direction returns to the origin page', () => {
    // Dragged right by 60% (toward page 0) then flicked left: back to 1, not 2.
    expect(settlePage({ offset: at(1) + WIDTH * 0.6, velocity: -900, width: WIDTH, count: COUNT, from: 1 })).toBe(1);
  });

  it('degrades safely before layout has reported a width', () => {
    expect(settlePage({ offset: -10, velocity: -900, width: 0, count: COUNT, from: 1 })).toBe(0);
  });
});

describe('mountedPages', () => {
  it('mounts the active page and its neighbours, within range', () => {
    expect(mountedPages(0, 4, 1)).toEqual([0, 1]);
    expect(mountedPages(2, 4, 1)).toEqual([1, 2, 3]);
    expect(mountedPages(3, 4, 1)).toEqual([2, 3]);
    expect(mountedPages(1, 4, 0)).toEqual([1]);
  });
});

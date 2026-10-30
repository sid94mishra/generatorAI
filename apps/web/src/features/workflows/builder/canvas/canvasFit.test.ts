import { describe, expect, it } from 'vitest';
import { READABLE_ZOOM, readableViewport } from './canvasFit.js';

describe('readableViewport', () => {
  it('fits a small graph whole', () => {
    const v = readableViewport({ x: 0, y: 0, width: 600, height: 200 }, 1200, 800);
    expect(v.zoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
    expect(v.zoom).toBeLessThanOrEqual(1);
  });

  it('opens a long chain at a readable zoom, anchored to its first stage and centred vertically', () => {
    const v = readableViewport({ x: 100, y: 0, width: 6000, height: 200 }, 1200, 800);
    expect(v.zoom).toBe(READABLE_ZOOM);
    expect(v.x).toBe(48 - 100 * READABLE_ZOOM);
    expect(v.y).toBe((800 - 200 * READABLE_ZOOM) / 2);
  });

  it('anchors to the top when the graph is too tall too', () => {
    const v = readableViewport({ x: 0, y: 50, width: 6000, height: 4000 }, 1200, 800);
    expect(v.y).toBe(48 - 50 * READABLE_ZOOM);
  });
});

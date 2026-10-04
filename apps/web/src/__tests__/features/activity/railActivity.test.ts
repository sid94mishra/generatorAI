import { describe, expect, it } from 'vitest';
import { RAIL_TILE_LIMIT, railTileCapacity } from '@/features/activity/RailActivity.js';

describe('railTileCapacity (D-92 rail quick access)', () => {
  it('shows every tile that fits, up to the limit', () => {
    expect(railTileCapacity(400, 3)).toBe(3);
    expect(railTileCapacity(1000, 9)).toBe(RAIL_TILE_LIMIT);
  });
  it('leaves room for "+N" when they do not all fit, and never goes negative', () => {
    // 13 divider + 26 overflow + 2 × 36 tiles = 111.
    expect(railTileCapacity(111, 5)).toBe(2);
    expect(railTileCapacity(40, 5)).toBe(0);
    expect(railTileCapacity(0, 0)).toBe(0);
  });
});

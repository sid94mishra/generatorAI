import { describe, expect, it } from 'vitest';

import { qrMatrix, qrPath } from '../qrMatrix';

/** A 7×7 finder pattern: dark ring, light ring, dark 3×3 core. */
function hasFinder(m: ReturnType<typeof qrMatrix>, top: number, left: number): boolean {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (m.cells[(top + r) * m.size + left + c] !== (ring || core)) return false;
    }
  }
  return true;
}

describe('qrMatrix', () => {
  it('produces a valid-size symbol with the three finder patterns', () => {
    const m = qrMatrix('generatorai://pair?code=' + 'A'.repeat(300));
    expect((m.size - 17) % 4).toBe(0);
    expect(m.cells).toHaveLength(m.size * m.size);
    expect(hasFinder(m, 0, 0)).toBe(true);
    expect(hasFinder(m, 0, m.size - 7)).toBe(true);
    expect(hasFinder(m, m.size - 7, 0)).toBe(true);
  });

  it('grows with the payload', () => {
    expect(qrMatrix('x'.repeat(400)).size).toBeGreaterThan(qrMatrix('x').size);
  });

  it('draws one subpath per horizontal run, offset by the margin', () => {
    const path = qrPath({ size: 3, cells: [true, true, false, false, false, false, false, false, true] }, 4);
    expect(path).toBe('M4 4h2v1h-2zM6 6h1v1h-1z');
  });
});

import { expect, it } from 'vitest';
import { weekRange } from '../weekRange';
it('uses local Monday midnight and retains the exact endpoint', () => {
  for (const day of [28, 29, 30]) {
    const now = new Date(2026, 8, day, 15, 30);
    expect(weekRange(now)).toEqual({ from: new Date(2026, 8, 28).toISOString(), to: now.toISOString() });
  }
});
it('Sunday belongs to the previous Monday, including year boundaries', () => {
  expect(weekRange(new Date(2027, 0, 3, 23)).from).toBe(new Date(2026, 11, 28).toISOString());
});

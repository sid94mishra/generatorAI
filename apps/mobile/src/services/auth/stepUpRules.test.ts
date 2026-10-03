import { describe, expect, it } from 'vitest';
import { stepUpExpiredByAbsence } from './stepUpRules';

describe('step-up cache and absence (06 §6.4)', () => {
  it('forgets the step-up after an absence of at least the lock grace', () => {
    expect(stepUpExpiredByAbsence(1_000, 61_000, 60)).toBe(true);
    expect(stepUpExpiredByAbsence(1_000, 60_999, 60)).toBe(false);
  });

  it('forgets on any background with "Immediately", never without one, and fails closed on a clock step back', () => {
    expect(stepUpExpiredByAbsence(1_000, 1_000, 0)).toBe(true);
    expect(stepUpExpiredByAbsence(null, 999_999, 0)).toBe(false);
    expect(stepUpExpiredByAbsence(5_000, 1_000, 300)).toBe(true);
  });
});

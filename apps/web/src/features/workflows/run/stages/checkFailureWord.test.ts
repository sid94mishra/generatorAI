import { describe, expect, it } from 'vitest';
import { checkFailureWord } from './StageRow.js';

describe('checkFailureWord (U-18)', () => {
  it('names a failed check by its exit code', () => {
    expect(checkFailureWord({ passed: false, exitCode: 1, timedOut: false })).toBe('Check failed · exit 1');
  });
  it('names a timeout', () => {
    expect(checkFailureWord({ passed: false, exitCode: -1, timedOut: true })).toBe('Check timed out');
  });
  it('is null for a passing check or no output', () => {
    expect(checkFailureWord({ passed: true, exitCode: 0 })).toBeNull();
    expect(checkFailureWord(undefined)).toBeNull();
  });
});

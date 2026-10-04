import { describe, expect, it } from 'vitest';
import { compareModesOf } from '../CompareBar.js';

describe('compareModesOf', () => {
  it('names the branch base by branch, and a commit base by its short sha', () => {
    expect(compareModesOf([{ value: 'ref:main', label: 'Branch base (main)' }]).branch?.label).toBe('Branch vs main');
    expect(
      compareModesOf([{ value: 'ref:x', label: 'Branch base (7838f44b11b4454ad3f8e92fe0998a11134a3df4)' }]).branch?.label,
    ).toBe('Branch vs 7838f44');
  });
});

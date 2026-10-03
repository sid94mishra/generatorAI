import { describe, expect, it } from 'vitest';
import { cleanupSummary } from '../model/storageModel';

describe('cleanup result (MSetStorage)', () => {
  it('says what was removed and what will be retried', () => {
    expect(cleanupSummary({ tracked: 0, orphans: 0, failed: 0 })).toBe('Nothing was old enough to remove.');
    expect(cleanupSummary({ tracked: 1, orphans: 0, failed: 0 })).toBe('Removed 1 workspace.');
    expect(cleanupSummary({ tracked: 2, orphans: 1, failed: 2 })).toBe('Removed 3 workspaces (1 orphaned); 2 in use will be retried tonight.');
  });
});

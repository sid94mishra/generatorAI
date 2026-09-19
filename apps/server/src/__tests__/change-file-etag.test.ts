import { describe, expect, it } from 'vitest';
import { changeFileEtag } from '../routes/changeFileEtag.js';

describe('change file response validation', () => {
  it('invalidates an empty or changed patch even when blob identities match', () => {
    const empty = { cacheKey: 'none:abc', path: 'a.js', patch: '' };
    const populated = { ...empty, patch: '@@ -0,0 +1 @@\n+hello\n' };
    expect(changeFileEtag(empty)).not.toBe(changeFileEtag(populated));
    expect(changeFileEtag(populated)).toBe(changeFileEtag({ ...populated }));
  });

  it('distinguishes representation metadata and truncation for the same blobs', () => {
    const result = { cacheKey: 'abc:def', path: 'a.js', patch: 'diff', truncated: false };
    expect(changeFileEtag(result)).not.toBe(changeFileEtag({ ...result, truncated: true }));
    expect(changeFileEtag(result)).not.toBe(changeFileEtag({ ...result, path: 'b.js' }));
  });
});

import { describe, expect, it } from 'vitest';

import { duplicateNames, isDuplicateName, shortId } from '../components/common/disambiguate';

describe('duplicateNames', () => {
  it('finds names that occur more than once, case- and space-insensitively', () => {
    const dupes = duplicateNames(
      [{ name: 'V project' }, { name: 'v project ' }, { name: 'E2E Test Project' }],
      (p) => p.name,
    );
    expect(isDuplicateName(dupes, 'V project')).toBe(true);
    expect(isDuplicateName(dupes, 'E2E Test Project')).toBe(false);
  });

  it('shortens ids to a scannable suffix', () => {
    expect(shortId('3f2a9c1e-77aa-4b2e-9d10-a1b2c3d4e5f6')).toBe('d4e5f6');
    expect(shortId('p1')).toBe('p1');
  });
});

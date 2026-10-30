import { describe, expect, it } from 'vitest';
import { isProjectSlug, projectLabelRole } from './projectLabel';

describe('project label font (MD-163)', () => {
  it('treats lowercase slugs and paths as mono', () => {
    for (const s of ['payments-service', 'api', 'web.app', 'org/repo', 'v2_core', '9lives']) {
      expect(isProjectSlug(s)).toBe(true);
      expect(projectLabelRole(s)).toBe('monoSm');
    }
  });
  it('keeps display names in sans', () => {
    for (const s of ['Mobile sandbox repo', 'Payments', 'payments service', 'API', '-leading', '.hidden', '', 'café']) {
      expect(isProjectSlug(s)).toBe(false);
      expect(projectLabelRole(s)).toBe('footnote');
    }
  });
});

import { describe, expect, it } from 'vitest';

import { filterTemplates, parseTemplates, templateSubtitle } from '../components/work/templateModel';

const RAW = [
  { id: 'b', name: 'Bug fix', category: 'engineering', stages: [{}, {}], description: 'Fix a bug' },
  { id: 'a', name: 'Audit', category: 'security', stages: [{}] },
  { id: 'c', name: 'Changelog', category: 'engineering' },
  { name: 'no id' },
];

describe('templates', () => {
  it('parses, drops id-less entries and sorts by category then name', () => {
    expect(parseTemplates(RAW).map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(parseTemplates('x')).toEqual([]);
  });

  it('filters by name, description or category', () => {
    const list = parseTemplates(RAW);
    expect(filterTemplates(list, 'SECUR').map((t) => t.id)).toEqual(['a']);
    expect(filterTemplates(list, 'fix').map((t) => t.id)).toEqual(['b']);
    expect(filterTemplates(list, ' ')).toHaveLength(3);
  });

  it('summarises', () => {
    expect(templateSubtitle(parseTemplates(RAW)[0]!)).toBe('engineering · 2 stages · Fix a bug');
  });
});

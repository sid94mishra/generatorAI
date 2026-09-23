import { describe, expect, it } from 'vitest';

import { changeTreeRows } from '../components/chat/panes/changeTree';

describe('changeTreeRows', () => {
  it('lists folders first, sorted, with single-child chains collapsed', () => {
    const rows = changeTreeRows([
      { path: 'test/discounts.test.js' },
      { path: 'src/pricing/discounts.js' },
      { path: 'README.md' },
      { path: 'src/pricing/rules/fixed.js' },
    ]);
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.kind === 'dir' ? `${r.label}/` : r.label}`)).toEqual([
      'src/pricing/',
      '  rules/',
      '    fixed.js',
      '  discounts.js',
      'test/',
      '  discounts.test.js',
      'README.md',
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { humanKey, outputView } from '../model/outputView';

describe('StructuredOutputView model (MG-32 absent)', () => {
  it('draws an array of flat objects as a table, at most four columns', () => {
    const v = outputView([
      { package: 'express', from: '4.21.2', to: '5.1.0', risk: 'Medium', dev: false },
      { package: 'zod', from: '3.23.8', to: '3.25.1', risk: 'Low', dev: false },
    ]);
    expect(v).toMatchObject({ kind: 'table', columns: ['package', 'from', 'to', 'risk'], total: 2 });
    if (v.kind === 'table') expect(v.rows[0]).toEqual(['express', '4.21.2', '5.1.0', 'Medium']);
  });

  it('lifts the one table member of a small object and names it', () => {
    const v = outputView({ proposed_upgrades: [{ name: 'a', risk: 'Low' }], majors: 3 });
    expect(v).toMatchObject({ kind: 'table', title: 'Proposed upgrades' });
  });

  it('falls back to a key / value tree, and to text', () => {
    const v = outputView({ verdict: 'pass', checks: { lint: true, tests: [1, 2] } });
    expect(v).toEqual({
      kind: 'tree',
      rows: [
        { depth: 0, key: 'verdict', value: 'pass' },
        { depth: 0, key: 'checks', value: null },
        { depth: 1, key: 'lint', value: 'true' },
        { depth: 1, key: 'tests', value: '1, 2' },
      ],
    });
    expect(outputView('plain')).toEqual({ kind: 'text', text: 'plain' });
    expect(humanKey('openComments')).toBe('Open comments');
  });
});

import { describe, expect, it } from 'vitest';

import { pathCrumbs } from './crumbs';

describe('pathCrumbs (06 §3.3)', () => {
  it('names the real ancestors of a legacy detail', () => {
    expect(pathCrumbs('/workflows/w1/runs/r1/stages/s1')).toEqual([
      { label: 'Workflows', href: '/workflows' },
      { label: 'Workflow', href: '/workflows/w1' },
      { label: 'Run', href: '/workflows/w1/runs/r1' },
    ]);
    expect(pathCrumbs('/projects/p1/codebases/c1/pull-requests/4').map((c) => c.label)).toEqual(['Projects', 'Project', 'Codebase']);
    expect(pathCrumbs('/settings/appearance')).toEqual([{ label: 'Settings', href: '/settings' }]);
    expect(pathCrumbs('/chats')).toEqual([]);
    expect(pathCrumbs('/pair')).toEqual([]);
  });
});

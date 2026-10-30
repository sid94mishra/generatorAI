import { describe, expect, it } from 'vitest';
import type { WorkspaceCheckpoint } from '@generatorai/client-core';

import { scrubberStops, selectedStop, stopTitle } from './scrubberModel';

const cp = (over: Partial<WorkspaceCheckpoint>): WorkspaceCheckpoint => ({ workspaceId: 'w', repoAlias: '.', kind: 'turn', id: 'x', createdAt: 0, ...over }) as WorkspaceCheckpoint;

describe('checkpoint scrubber (MB-32)', () => {
  it('keeps one stop per turn, oldest first, with its prompt and stats', () => {
    const stops = scrubberStops([
      cp({ id: 'b2', turnId: 't2', phase: 'before', createdAt: 20, promptExcerpt: 'Also cover zero' }),
      cp({ id: 'a2', turnId: 't2', phase: 'after', createdAt: 25, fileCount: 2, additions: 14, deletions: 6 }),
      cp({ id: 'b1', turnId: 't1', phase: 'before', createdAt: 10 }),
      cp({ id: 'base', kind: 'baseline', createdAt: 1 }),
      cp({ id: 'm', kind: 'manual', createdAt: 30 }),
    ]);
    expect(stops.map((s) => s.compareValue)).toEqual(['turn:t1', 'turn:t2']);
    expect(stops[1]).toMatchObject({ prompt: 'Also cover zero', fileCount: 2, additions: 14, deletions: 6 });
    expect(selectedStop(stops, 'turn:t1')).toBe(0);
    expect(selectedStop(stops, 'baseline')).toBe(1);
    expect(stopTitle(2, 4)).toBe('Turn 3 of 4');
  });
});

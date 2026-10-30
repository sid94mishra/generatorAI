import { describe, expect, it } from 'vitest';
import { orderStageRuns } from '../routes/workflowRunOrder.js';

describe('run outline order', () => {
  it('keeps a recently updated approval stage after its predecessors without mutating rows', () => {
    const rows = [{ id: 'h', stageKey: 'handoff' }, { id: 'd', stageKey: 'design' }];
    expect(orderStageRuns(rows, ['design', 'build', 'review', 'handoff']).map((s) => s.id)).toEqual(['d', 'h']);
    expect(rows[0]?.id).toBe('h');
  });
  it('breaks ties by id and keeps the given order without stage keys', () => {
    const rows = [{ id: 'b', stageKey: 'x' }, { id: 'a', stageKey: 'x' }];
    expect(orderStageRuns(rows, ['x']).map((s) => s.id)).toEqual(['a', 'b']);
    expect(orderStageRuns(rows, undefined)).toEqual(rows);
  });
});

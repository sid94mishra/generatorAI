import { describe, expect, it } from 'vitest';
import { orderStageRuns } from '../routes/workflowRunOrder.js';

describe('run outline order', () => {
  it('keeps a recently updated approval stage after its predecessors without mutating rows', () => {
    const rows = [{ id: 'h', stageDefinitionId: 'handoff' }, { id: 'd', stageDefinitionId: 'design' }];
    expect(orderStageRuns(rows, [{ id: 'design', order: 0 }, { id: 'handoff', order: 3 }]).map((s) => s.id))
      .toEqual(['d', 'h']);
    expect(rows[0]?.id).toBe('h');
  });
  it('breaks ties by id and keeps the given order without a snapshot', () => {
    const rows = [{ id: 'b', stageDefinitionId: 'x' }, { id: 'a', stageDefinitionId: 'x' }];
    expect(orderStageRuns(rows, [{ id: 'x', order: 0 }]).map((s) => s.id)).toEqual(['a', 'b']);
    expect(orderStageRuns(rows, undefined)).toEqual(rows);
  });
});

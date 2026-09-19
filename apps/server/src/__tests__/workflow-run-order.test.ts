import { describe, expect, it } from 'vitest';
import { orderStageRuns } from '../routes/workflowRunOrder.js';

describe('run outline order', () => {
  it('keeps a recently updated approval stage after its predecessors without mutating rows', () => {
    const rows = [{ id: 'h', stageDefinitionId: 'handoff' }, { id: 'd', stageDefinitionId: 'design' }];
    expect(orderStageRuns(rows, [{ id: 'design', order: 0 }, { id: 'handoff', order: 3 }]).map((s) => s.id))
      .toEqual(['d', 'h']);
    expect(rows[0].id).toBe('h');
  });
  it('orders repeated iterations and retains legacy order without a snapshot', () => {
    const rows = [{ id: 'second', stageDefinitionId: 'loop', iterationIndex: 1 }, { id: 'first', stageDefinitionId: 'loop', iterationIndex: 0 }];
    expect(orderStageRuns(rows, [{ id: 'loop', order: 0 }]).map((s) => s.id)).toEqual(['first', 'second']);
    expect(orderStageRuns(rows, undefined)).toEqual(rows);
  });
});

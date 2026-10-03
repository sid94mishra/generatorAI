import { describe, expect, it } from 'vitest';
import type { WorkflowDefinitionRecord, WorkflowGraph } from '@generatorai/workflow-spec';

import { changeCount, freshErrors, isDirty, useBuilderStore } from '../builder/builderStore';

const graph = (name: string): WorkflowGraph => ({ formatVersion: 2, workflow: { name }, stages: [], edges: [] }) as unknown as WorkflowGraph;
const record = (revision: number, g = graph('W')): WorkflowDefinitionRecord => ({ id: 'w1', revision, graph: g }) as unknown as WorkflowDefinitionRecord;

describe('builder draft store (MD-85)', () => {
  it('edits with undo / redo, keeps the draft for the same revision, and tracks validation freshness', () => {
    const s = useBuilderStore.getState();
    s.open(record(1));
    s.edit('w1', () => graph('A'));
    s.edit('w1', () => graph('B'));
    let d = useBuilderStore.getState().drafts.w1!;
    expect(d.graph.workflow.name).toBe('B');
    expect(isDirty(d)).toBe(true);
    expect(changeCount(d)).toBe(2);
    s.undo('w1');
    expect(useBuilderStore.getState().drafts.w1!.graph.workflow.name).toBe('A');
    s.redo('w1');
    expect(useBuilderStore.getState().drafts.w1!.graph.workflow.name).toBe('B');
    s.open(record(1));
    expect(useBuilderStore.getState().drafts.w1!.graph.workflow.name).toBe('B');

    s.setValidation('w1', [{ code: 'x', severity: 'error', path: '', message: 'm' }]);
    expect(freshErrors(useBuilderStore.getState().drafts.w1)).toBe(true);
    s.edit('w1', () => graph('C'));
    expect(freshErrors(useBuilderStore.getState().drafts.w1)).toBe(false);

    s.edit('w1', () => graph('Ca'), 'name');
    s.edit('w1', () => graph('Cab'), 'name');
    expect(useBuilderStore.getState().drafts.w1!.past.at(-1)!.workflow.name).toBe('C');

    s.rebase(record(2, graph('C')), false);
    d = useBuilderStore.getState().drafts.w1!;
    expect([d.base.revision, isDirty(d), d.past.length]).toEqual([2, false, 0]);
    s.close('w1');
    expect(useBuilderStore.getState().drafts.w1).toBeUndefined();
  });
});

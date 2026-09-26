import { describe, expect, it } from 'vitest';
import { WorkflowGraphSchema, type WorkflowTemplate } from '@generatorai/workflow-spec';
import { blockingReason, documentSummary, draftGraph, importDocumentWith, stageOutline } from './newWorkflowModel.js';

const basics = { name: '  Issue fix ', description: ' Fix it ', projectId: '11111111-1111-4111-8111-111111111111', codebaseAliases: ['api'] };

const template = {
  id: 'fix-review',
  category: 'code-review',
  graph: WorkflowGraphSchema.parse({
    formatVersion: 2,
    workflow: { name: 'Fix and review', description: 'template', lifecycle: { useWorktree: false } },
    stages: [
      { kind: 'agent', key: 'triage', name: 'Triage', prompts: [{ label: 'p', text: 'triage' }] },
      { kind: 'loop', key: 'fix_review', name: 'Fix and review', loop: { maxIterations: 5 } },
      { kind: 'agent', key: 'fix', name: 'Fix', parentKey: 'fix_review', prompts: [{ label: 'p', text: 'fix' }] },
    ],
    edges: [{ from: 'triage', to: 'fix_review' }],
  }),
} as WorkflowTemplate;

describe('new workflow model', () => {
  it('builds a blank draft that the schema accepts', () => {
    const g = draftGraph('blank', basics);
    expect(WorkflowGraphSchema.parse(g).workflow).toMatchObject({
      name: 'Issue fix',
      description: 'Fix it',
      projectId: basics.projectId,
      lifecycle: { codebaseAliases: ['api'] },
    });
    expect(g.stages).toEqual([]);
  });

  it('keeps the template graph and applies the basics (lifecycle merged)', () => {
    const g = WorkflowGraphSchema.parse(draftGraph('template', { ...basics, description: '', projectId: '' }, template));
    expect(g.stages.map((s) => s.key)).toEqual(['triage', 'fix_review', 'fix']);
    expect(g.workflow.name).toBe('Issue fix');
    expect(g.workflow.description).toBeUndefined();
    expect(g.workflow.projectId).toBeNull();
    expect(g.workflow.lifecycle).toMatchObject({ useWorktree: false, codebaseAliases: ['api'] });
  });

  it('outlines top-level stages with their bodies', () => {
    expect(stageOutline(template.graph)).toEqual([
      { key: 'triage', kind: 'agent', body: [] },
      { key: 'fix_review', kind: 'loop', body: ['fix'], max: 5 },
    ]);
  });

  it('summarizes and overlays an imported document', () => {
    const doc = { formatVersion: 2, workflow: { name: 'Doc', description: 'd' }, stages: [{}, {}] };
    expect(documentSummary(doc)).toEqual({ name: 'Doc', description: 'd', stages: 2, projectId: null });
    expect(documentSummary([])).toBeNull();
    expect(importDocumentWith(doc, basics)).toMatchObject({ workflow: { name: 'Issue fix', description: 'Fix it', projectId: basics.projectId } });
    expect(importDocumentWith('x', basics)).toBe('x');
  });

  it('says what blocks Create', () => {
    expect(blockingReason('template', basics, {})).toBe('Pick a template');
    expect(blockingReason('import', basics, { document: {} })).toBe('Choose a workflow document');
    expect(blockingReason('blank', { ...basics, name: ' ' }, {})).toBe('Name the workflow');
    expect(blockingReason('blank', basics, {})).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { WorkflowTemplate } from '@generatorai/workflow-spec';

import { checkImport, createBlocker, draftGraph, filterTemplates, templateCategories, templateViews } from '../model/newWorkflowModel';

const TEMPLATE = {
  id: 'fix-review',
  category: 'code-review',
  graph: {
    formatVersion: 2,
    workflow: { name: 'Fix → review', description: 'Fix, then review', session: {}, variables: [{ name: 'issue_url', type: 'string', label: 'Issue', required: true }], hooks: [], lifecycle: { codebaseAliases: [], useWorktree: true, requiresCodebase: false, sandbox: 'required', preprocessingSteps: [], postProcessing: { autoCommit: false, autoPush: false, autoCreatePR: false, steps: [] } }, tags: [] },
    stages: [
      { key: 'fix_review', name: 'Fix and review', kind: 'loop', join: { mode: 'all' }, loop: { maxIterations: 5, exits: [], onLimit: { mode: 'pause' } } },
      { key: 'fix', name: 'Fix', kind: 'agent', parentKey: 'fix_review', join: { mode: 'all' }, prompts: [] },
    ],
    edges: [],
  },
} as unknown as WorkflowTemplate;

const BASICS = { name: 'Issue fix', description: '', projectId: 'p1', codebaseAliases: ['api'], session: { model: 'm1' } };

describe('new workflow', () => {
  it('describes templates by their kinds and top-level stages', () => {
    const [v] = templateViews([TEMPLATE]);
    expect(v).toMatchObject({ stageCount: 1, kinds: ['Loop'], variables: ['issue_url'] });
    expect(v!.stages[0]!.body.map((b) => b.key)).toEqual(['fix']);
    expect(templateCategories([v!])).toEqual(['code-review']);
    expect(filterTemplates([v!], 'testing', '')).toEqual([]);
    expect(filterTemplates([v!], null, 'loop')).toHaveLength(1);
  });

  it('applies the basics over a template, a blank and an import', () => {
    const fromTemplate = draftGraph('template', BASICS, { template: TEMPLATE });
    expect(fromTemplate.workflow).toMatchObject({ name: 'Issue fix', projectId: 'p1', session: { model: 'm1' }, lifecycle: { codebaseAliases: ['api'] } });
    expect(fromTemplate.workflow.description).toBeUndefined();
    expect(fromTemplate.stages).toHaveLength(2);
    expect(draftGraph('blank', BASICS).stages).toEqual([]);
    const imported = draftGraph('import', { ...BASICS, projectId: '' }, { imported: { formatVersion: 2, workflow: { name: 'x', session: { model: 'old', agentRef: 'system:bug-fixer' } }, stages: [], edges: [] } });
    expect(imported.workflow).toMatchObject({ name: 'Issue fix', projectId: null, session: { model: 'm1', agentRef: 'system:bug-fixer' } });
  });

  it('validates a pasted document', () => {
    expect(checkImport('{nope').document).toBeNull();
    const ok = checkImport(JSON.stringify({ formatVersion: 2, workflow: { name: 'Doc' }, stages: [], edges: [] }));
    expect(ok.errors).toEqual([]);
    expect(ok.summary?.name).toBe('Doc');
    expect(checkImport(JSON.stringify({ formatVersion: 2, workflow: { name: 'Doc', bogus: 1 }, stages: [] })).errors.length).toBeGreaterThan(0);
  });

  it('says why Create is disabled', () => {
    const none = { templateId: null, importCheck: null, takenNames: new Set<string>() };
    expect(createBlocker('template', BASICS, none)).toBe('Choose a template');
    expect(createBlocker('blank', { ...BASICS, name: ' ' }, none)).toBe('Name the workflow');
    expect(createBlocker('blank', BASICS, { ...none, takenNames: new Set(['issue fix']) })).toBe('A workflow already has this name');
    expect(createBlocker('blank', BASICS, none)).toBeNull();
  });
});

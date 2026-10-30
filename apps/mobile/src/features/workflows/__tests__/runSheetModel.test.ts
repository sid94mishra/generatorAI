import { describe, expect, it } from 'vitest';
import { ApiError } from '@generatorai/client-core';
import type { InvocationPlan } from '@generatorai/workflow-spec';

import { EMPTY_OPTIONS, invocationBody, issueLines, planCodebases, planHeadline, planLayers, runActions, stagesIncluded } from '../model/runSheetModel';

describe('run sheet', () => {
  it('fills Run for a published workflow, Test run for a draft', () => {
    expect(runActions({ status: 'draft', hasUnpublishedChanges: true })).toEqual({ primary: 'test', secondaryTest: false });
    expect(runActions({ status: 'published', hasUnpublishedChanges: true })).toEqual({ primary: 'run', secondaryTest: true });
    expect(runActions({ status: 'published', hasUnpublishedChanges: false })).toEqual({ primary: 'run', secondaryTest: false });
  });

  it('sends nothing for untouched options', () => {
    expect(invocationBody('w1', { variables: { a: 1 }, test: true })).toEqual({ target: { kind: 'definition', workflowDefinitionId: 'w1', testRun: true }, variables: { a: 1 }, client: 'mobile' });
    expect(invocationBody('w1', { variables: {}, test: false, options: { ...EMPTY_OPTIONS, stages: [{ stageKey: 's', stageName: 'S', skip: false, variables: {} }] } })).toEqual({ target: { kind: 'definition', workflowDefinitionId: 'w1' }, variables: {}, client: 'mobile' });
  });

  it('carries every option the sheet edits', () => {
    const body = invocationBody('w1', {
      variables: {},
      test: false,
      options: {
        stages: [
          { stageKey: 'scan', stageName: 'Scan', skip: true, variables: {} },
          { stageKey: 'fix', stageName: 'Fix', skip: false, variables: { focus: 'api' }, model: 'm2' },
        ],
        model: 'm1',
        effort: 'high',
        name: '  Nightly  ',
        stopAfterMinutes: 30,
        permission: 'acceptEdits',
        codebases: [{ alias: 'api', selected: true, baseRef: 'main', mode: 'worktree' }, { alias: 'web', selected: false, baseRef: '', mode: 'worktree' }],
        projectId: 'p1',
      },
    });
    expect(body).toMatchObject({
      projectId: 'p1',
      codebases: [{ alias: 'api', mode: 'worktree', baseRef: 'main' }],
      stageOverrides: [{ stageKey: 'scan', skip: true }, { stageKey: 'fix', variables: { focus: 'api' }, model: 'm2' }],
      overrides: { model: 'm1', reasoningEffort: 'high', permissionMode: 'acceptEdits' },
      name: 'Nightly',
      budget: { maxDurationMs: 1_800_000 },
    });
    expect(stagesIncluded([{ stageKey: 'a', stageName: 'A', skip: true, variables: {} }, { stageKey: 'b', stageName: 'B', skip: false, variables: {} }])).toBe('1 of 2');
  });

  it('groups the plan by layer', () => {
    const plan = {
      stages: [
        { key: 'scan', name: 'Scan', layer: 0, skipped: false, approvalRequired: false, kind: 'agent' },
        { key: 'apply', name: 'Apply', layer: 1, skipped: false, approvalRequired: true, kind: 'agent' },
        { key: 'notify', name: 'Notify', layer: 1, skipped: true, skipReason: 'override', approvalRequired: false, kind: 'agent' },
        { key: 'inner', name: 'Inner', layer: 1, skipped: false, approvalRequired: false, kind: 'agent', parentKey: 'loop' },
      ],
      codebases: [{ alias: 'api', baseRef: 'main', mode: 'worktree', source: 'request' }],
    } as unknown as InvocationPlan;
    expect(planLayers(plan).map((l) => l.stages.map((s) => s.key))).toEqual([['scan'], ['apply', 'notify']]);
    expect(planHeadline(plan)).toBe('2 layers · 1 approval gate');
    expect(planCodebases(plan)).toBe('api @ main · worktree');
  });

  it('lists the server issues', () => {
    const e = new ApiError(400, '/x', 'bad', { error: { issues: [{ code: 'x', path: ['variables', 'a'], message: 'Required', severity: 'error' }, { code: 'w', path: [], message: 'meh', severity: 'warning' }] } });
    expect(issueLines(e)).toEqual(['variables.a — Required']);
  });
});

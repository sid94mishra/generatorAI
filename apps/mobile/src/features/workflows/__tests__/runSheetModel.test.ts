import { describe, expect, it } from 'vitest';
import { ApiError } from '@generatorai/client-core';

import { invocationBody, issueLines, runActions } from '../model/runSheetModel';

describe('run sheet', () => {
  it('fills Run for a published workflow, Test run for a draft', () => {
    expect(runActions({ status: 'draft', hasUnpublishedChanges: true })).toEqual({ primary: 'test', secondaryTest: false });
    expect(runActions({ status: 'published', hasUnpublishedChanges: true })).toEqual({ primary: 'run', secondaryTest: true });
    expect(runActions({ status: 'published', hasUnpublishedChanges: false })).toEqual({ primary: 'run', secondaryTest: false });
  });

  it('builds one invocation', () => {
    expect(invocationBody('w1', { variables: { a: 1 }, test: true })).toEqual({ target: { kind: 'definition', workflowDefinitionId: 'w1', testRun: true }, variables: { a: 1 }, client: 'mobile' });
  });

  it('lists the server issues', () => {
    const e = new ApiError(400, '/x', 'bad', { error: { issues: [{ code: 'x', path: ['variables', 'a'], message: 'Required', severity: 'error' }, { code: 'w', path: [], message: 'meh', severity: 'warning' }] } });
    expect(issueLines(e)).toEqual(['variables.a — Required']);
  });
});

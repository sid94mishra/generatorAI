import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@generatorai/workflow-spec';

import { errorsByStage, issueStageKey, sortIssues, validationHeadline } from './validationModel';

const issue = (severity: 'error' | 'warning', extra: Partial<ValidationIssue> = {}): ValidationIssue => ({ code: 'x', severity, path: '', message: 'm', ...extra });

describe('ValidationList model (MB-37)', () => {
  it('heads the list and sorts errors first', () => {
    const list = [issue('warning'), issue('error'), issue('error')];
    expect(validationHeadline(list)).toBe('2 errors · 1 warning');
    expect(validationHeadline([])).toBe('All clear');
    expect(sortIssues(list).map((i) => i.severity)).toEqual(['error', 'error', 'warning']);
  });

  it('finds the stage from the key or the pointer and counts errors per stage', () => {
    const keys = ['scan', 'assess'];
    expect(issueStageKey(issue('error', { path: '/stages/1/prompts/0' }), keys)).toBe('assess');
    expect(issueStageKey(issue('error', { stageKey: 'scan' }), keys)).toBe('scan');
    expect(issueStageKey(issue('error', { path: '/workflow/name' }), keys)).toBeNull();
    expect([...errorsByStage([issue('error', { stageKey: 'scan' }), issue('warning', { stageKey: 'scan' }), issue('error', { path: '/stages/1' })], keys)]).toEqual([
      ['scan', 1],
      ['assess', 1],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { taskTitle } from '../taskTitle.js';

describe('taskTitle', () => {
  it('turns an orchestrator slug into a title with its acronyms upper-cased', () => {
    expect(taskTitle('qa-stabilise-flaky-tests')).toBe('QA stabilise flaky tests');
    expect(taskTitle('backend-shared-checker-api')).toBe('Backend shared checker API');
    expect(taskTitle('architect_spec_iter5')).toBe('Architect spec iter5');
  });

  it('keeps words the author already cased and falls back on an empty name', () => {
    expect(taskTitle('Fix PR #17 CI')).toBe('Fix PR #17 CI');
    expect(taskTitle('wire GitHub issues')).toBe('Wire GitHub issues');
    expect(taskTitle('--')).toBe('--');
  });
});

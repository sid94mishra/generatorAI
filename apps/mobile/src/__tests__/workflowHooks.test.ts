import { describe, expect, it } from 'vitest';

import { parseWorkflowHooks, phaseLabel } from '../components/work/workflowHooks';

describe('workflow hooks', () => {
  it('labels phases', () => {
    expect(phaseLabel('on_run_start')).toBe('On run start');
    expect(phaseLabel('preClone')).toBe('Pre clone');
    expect(phaseLabel('')).toBe('Unknown phase');
  });

  it('parses rows defensively', () => {
    const rows = parseWorkflowHooks([
      { id: 'h1', name: 'Notify', phase: 'on_run_complete', type: 'http', enabled: true, failurePolicy: 'continue' },
      { phase: 'on_run_start', type: 'script', enabled: false, failurePolicy: 'abort' },
      'junk',
    ]);
    expect(rows).toEqual([
      { id: 'h1', name: 'Notify', phase: 'on_run_complete', type: 'http', enabled: true, subtitle: 'On run complete · http · continues on failure' },
      { id: '1', name: 'On run start hook', phase: 'on_run_start', type: 'script', enabled: false, subtitle: 'On run start · script · stops the run on failure' },
    ]);
    expect(parseWorkflowHooks(undefined)).toEqual([]);
  });
});

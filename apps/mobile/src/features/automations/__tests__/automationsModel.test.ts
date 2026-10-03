import { describe, expect, it } from 'vitest';
import type { Automation } from '@generatorai/shared';

import {
  automationMenu,
  blankDraft,
  createBody,
  curlSample,
  datasetLine,
  draftFromAutomation,
  executionProgress,
  executionStatus,
  filterAutomations,
  pageProblem,
  retryLine,
  reviewRows,
  triggerLine,
  updateBody,
  webhookUrl,
  DEFAULT_RETRY,
} from '../model/automationsModel';
import { cronProblem, scheduleFromCron, scheduleSummary, scheduleToCron } from '../model/scheduleModel';

const automation: Automation = {
  id: 'a1',
  name: 'Nightly audit',
  enabled: true,
  triggerType: 'schedule',
  cronExpression: '0 2 * * *',
  timezone: 'America/New_York',
  workflowIds: ['w1'],
  variables: { target_branch: 'main', max: 3 },
  maxConcurrency: 3,
  onError: 'continue',
  dataSchema: { version: 1, format: 'json_array', fields: [{ name: 'codebase', type: 'string', required: true }] },
  defaultDataset: { format: 'json_array', data: '[{"codebase":"web"},{"codebase":"api"}]', parsedRowCount: 2 },
  permissionMode: 'acceptEdits',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('schedule', () => {
  it('turns presets into cron and back', () => {
    const base = scheduleFromCron(null, 'UTC');
    expect(scheduleToCron({ ...base, repeats: 'daily', hour: 2, minute: 0 })).toBe('0 2 * * *');
    expect(scheduleToCron({ ...base, repeats: 'weekdays', hour: 7, minute: 30 })).toBe('30 7 * * 1-5');
    expect(scheduleToCron({ ...base, repeats: 'weekly', hour: 16, minute: 0, days: [5, 1, 5] })).toBe('0 16 * * 1,5');
    expect(scheduleFromCron('30 7 * * 1-5', 'UTC')).toMatchObject({ repeats: 'weekdays', hour: 7, minute: 30 });
    expect(scheduleFromCron('*/15 * * * *', 'UTC').repeats).toBe('cron');
  });
  it('summarises and checks cron', () => {
    expect(scheduleSummary('0 2 * * *')).toBe('Daily 02:00');
    expect(scheduleSummary('0 16 * * 5')).toBe('Fridays 16:00');
    expect(scheduleSummary('0 9 * * 1,3')).toBe('Mon, Wed 09:00');
    expect(cronProblem('0 2 * * *')).toBeNull();
    expect(cronProblem('*/15 9-17 * * 1-5')).toBeNull();
    expect(cronProblem('0 2 * *')).toMatch(/five fields/);
    expect(cronProblem('61 2 * * *')).toMatch(/between 0 and 59/);
  });
});

describe('list and detail', () => {
  it('filters and describes rows', () => {
    expect(filterAutomations([automation, { ...automation, id: 'b', name: 'Other', enabled: false }], 'disabled', '').map((a) => a.id)).toEqual(['b']);
    expect(triggerLine(automation)).toBe('Daily 02:00');
    expect(triggerLine({ triggerType: 'webhook' })).toBe('Webhook · POST');
    expect(datasetLine(automation)).toBe('2 rows');
    expect(datasetLine({})).toBe('One run');
    expect(executionStatus('partial')).toEqual({ state: 'failed', label: 'Partly failed' });
    expect(executionStatus('cancelled').state).toBe('skipped');
    expect(executionProgress({ totalIterations: 14, completedIterations: 12, failedIterations: 2 })).toBe('2 of 14 failed');
    expect(executionProgress({ totalIterations: 3, completedIterations: 2, failedIterations: 0 })).toBe('2 of 3 finalized');
    expect(retryLine(DEFAULT_RETRY)).toBe('3 attempts · 1s × 2, max 60s · workflow_failed, timeout');
  });
  it('offers authoring only with write:workflows and running only with the run scope', () => {
    const ids = (m: ReturnType<typeof automationMenu>) => m.filter((e) => 'id' in e).map((e) => (e as { id: string }).id);
    expect(ids(automationMenu({ enabled: true }, true, true))).toEqual(['run', 'run-dataset', 'edit', 'duplicate', 'disable', 'delete']);
    expect(ids(automationMenu({ enabled: false }, false, true))).toEqual(['run', 'run-dataset']);
  });
});

describe('wizard', () => {
  it('round-trips an automation through the draft', () => {
    const d = draftFromAutomation(automation, 'UTC');
    expect(d.rows).toEqual(['web', 'api']);
    expect(d.schedule).toMatchObject({ repeats: 'daily', hour: 2, timezone: 'America/New_York' });
    const body = createBody(d);
    expect(body).toMatchObject({ cronExpression: '0 2 * * *', timezone: 'America/New_York', workflowIds: ['w1'], variables: { target_branch: 'main', max: 3 }, permissionMode: 'acceptEdits' });
    expect(JSON.parse(body.defaultDataset!.data)).toEqual([{ codebase: 'web' }, { codebase: 'api' }]);
    expect(updateBody(d)).not.toHaveProperty('projectId');
  });
  it('blocks each page on its own problem', () => {
    const d = blankDraft('UTC');
    expect(pageProblem(d, 0)).toMatch(/name/);
    expect(pageProblem({ ...d, triggerType: 'schedule', schedule: { ...d.schedule, repeats: 'cron', cron: 'nope' } }, 1)).toMatch(/five fields/);
    expect(pageProblem(d, 2)).toMatch(/workflow/);
    expect(pageProblem({ ...d, datasetJson: '{"a":1}' }, 3)).toMatch(/array/);
    expect(pageProblem({ ...d, variables: [{ key: '', value: 'x' }] }, 4)).toMatch(/name/);
    expect(pageProblem(d, 5)).toBeNull();
  });
  it('reviews with page links and survives a bad dataset', () => {
    const rows = reviewRows({ ...blankDraft('UTC'), name: 'X', datasetJson: '{bad' }, { project: 'All projects', workflows: [] });
    expect(rows.map((r) => r.page)).toEqual([0, 1, 2, 2, 3, 4, 4]);
  });
});

describe('webhook', () => {
  it('never puts the token in the URL it shows', () => {
    expect(webhookUrl('https://box:3100/')).toBe('https://box:3100/api/automations/webhooks/<token>');
    expect(curlSample([{ name: 'pr_number', type: 'number' }])).toContain(`-d '{"pr_number": 1}'`);
  });
});

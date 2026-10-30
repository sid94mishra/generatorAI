// The wizard's validation is the real risk in this port (CreateAutomationPage
// had 40 `useState`s and hand-rolled checks before this port) — each `it`
// below is one branch of `automationFormSchema`/`automationFormToParams`.
import { describe, expect, it } from 'vitest';
import {
  automationFormToParams,
  emptyAutomationForm,
  validateAutomationForm,
  type AutomationFormValues,
} from './automationFormSchema.js';

function form(partial: Partial<AutomationFormValues>): AutomationFormValues {
  return { ...emptyAutomationForm(), ...partial };
}

const VALID = form({ name: 'Nightly audit', workflowIds: ['wf-1'] });

describe('validateAutomationForm', () => {
  it('accepts a minimal manual automation', () => {
    expect(validateAutomationForm(VALID)).toEqual([]);
  });

  it('requires a name', () => {
    expect(validateAutomationForm(form({ ...VALID, name: '  ' }))).toContain('Name is required.');
  });

  it('requires at least one workflow', () => {
    expect(validateAutomationForm(form({ ...VALID, workflowIds: [] }))).toContain('Select at least one workflow.');
  });

  it('requires a valid cron expression for a schedule trigger', () => {
    expect(
      validateAutomationForm(form({ ...VALID, triggerType: 'schedule', cronExpression: 'not a cron' })),
    ).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(validateAutomationForm(form({ ...VALID, triggerType: 'schedule', cronExpression: '0 9 * * *' }))).toEqual([]);
  });

  it('does not require a cron expression for a manual or webhook trigger', () => {
    expect(validateAutomationForm(form({ ...VALID, triggerType: 'webhook', cronExpression: '' }))).toEqual([]);
  });

  it('requires the base variables to be valid JSON', () => {
    expect(validateAutomationForm(form({ ...VALID, variablesText: '{not json' }))).toContain('Variables must be valid JSON.');
    expect(validateAutomationForm(form({ ...VALID, variablesText: '{"a":1}' }))).toEqual([]);
  });

  it('validates the data schema JSON only when an input mode other than "single" is chosen', () => {
    expect(validateAutomationForm(form({ ...VALID, inputMode: 'single', dataSchemaText: '{broken' }))).toEqual([]);
    expect(validateAutomationForm(form({ ...VALID, inputMode: 'each_row', dataSchemaText: '{broken' }))).toContain(
      'Data schema must be valid JSON.',
    );
  });

  it('requires at least one field for "group_by" (Grouped rows)', () => {
    expect(validateAutomationForm(form({ ...VALID, inputMode: 'group_by', groupByFieldsText: '' }))).toContain(
      'Grouped rows needs at least one field.',
    );
    expect(validateAutomationForm(form({ ...VALID, inputMode: 'group_by', groupByFieldsText: 'priority' }))).toEqual([]);
  });

  it('requires maxAttempts >= 2 when retry is enabled', () => {
    expect(validateAutomationForm(form({ ...VALID, retryEnabled: true, retryMaxAttempts: 1 }))).toContain(
      'Retry needs at least 2 attempts (or turn it off).',
    );
    expect(validateAutomationForm(form({ ...VALID, retryEnabled: true, retryMaxAttempts: 3 }))).toEqual([]);
  });

  it('requires at least one retry-on class when retry is enabled', () => {
    expect(
      validateAutomationForm(
        form({ ...VALID, retryEnabled: true, retryOnFailed: false, retryOnTimeout: false, retryOnNetwork: false }),
      ),
    ).toContain('Retry policy needs at least one error class selected.');
  });

  it('ignores retry fields entirely when retry is disabled', () => {
    expect(
      validateAutomationForm(
        form({ ...VALID, retryEnabled: false, retryMaxAttempts: 1, retryOnFailed: false, retryOnTimeout: false, retryOnNetwork: false }),
      ),
    ).toEqual([]);
  });
});

describe('automationFormToParams', () => {
  it('omits dataSchema/iterationMode/retryPolicy for a plain single-run automation', () => {
    const params = automationFormToParams(VALID);
    expect(params.dataSchema).toBeUndefined();
    expect(params.iterationMode).toBeUndefined();
    expect(params.retryPolicy).toBeUndefined();
    expect(params.workflowIds).toEqual(['wf-1']);
  });

  it('maps inputMode "each_row" onto {kind: "each_row"}', () => {
    const params = automationFormToParams(form({ ...VALID, inputMode: 'each_row' }));
    expect(params.iterationMode).toEqual({ kind: 'each_row' });
    expect(params.dataSchema).toBeDefined();
  });

  it('maps inputMode "group_by" onto {kind: "group_by", fields, groupVariable}', () => {
    const params = automationFormToParams(
      form({ ...VALID, inputMode: 'group_by', groupByFieldsText: 'priority, team', groupVariable: 'rows' }),
    );
    expect(params.iterationMode).toEqual({ kind: 'group_by', fields: ['priority', 'team'], groupVariable: 'rows' });
  });

  it('maps inputMode "whole_dataset" onto the schema-driven {kind: "single", datasetVariable} — distinct from the top-level "single" (no schema) state', () => {
    const params = automationFormToParams(form({ ...VALID, inputMode: 'whole_dataset', groupVariable: 'rows' }));
    expect(params.iterationMode).toEqual({ kind: 'single', datasetVariable: 'rows' });
    expect(params.dataSchema).toBeDefined();
  });

  it('only sends a defaultDataset when the dataset text is non-empty', () => {
    const withoutDataset = automationFormToParams(form({ ...VALID, inputMode: 'each_row', defaultDatasetText: '' }));
    expect(withoutDataset.defaultDataset).toBeUndefined();
    const withDataset = automationFormToParams(
      form({ ...VALID, inputMode: 'each_row', defaultDatasetFormat: 'csv', defaultDatasetText: 'a,b\n1,2' }),
    );
    expect(withDataset.defaultDataset).toEqual({ format: 'csv', data: 'a,b\n1,2' });
  });

  it('builds a retryPolicy only from the checked error classes', () => {
    const params = automationFormToParams(
      form({ ...VALID, retryEnabled: true, retryOnFailed: true, retryOnTimeout: false, retryOnNetwork: true, retryMaxAttempts: 4 }),
    );
    expect(params.retryPolicy).toEqual({
      maxAttempts: 4,
      initialBackoffMs: 1000,
      backoffMultiplier: 2,
      maxBackoffMs: 60_000,
      retryOn: ['workflow_failed', 'network'],
    });
  });

  it('sends schedule-only fields (timezone, missedRunPolicy, overlapPolicy, cron) only for a schedule trigger', () => {
    const manual = automationFormToParams(form({ ...VALID, triggerType: 'manual' }));
    expect(manual.cronExpression).toBeUndefined();
    expect(manual.timezone).toBeUndefined();
    expect(manual.missedRunPolicy).toBeUndefined();
    expect(manual.overlapPolicy).toBeUndefined();

    const scheduled = automationFormToParams(
      form({ ...VALID, triggerType: 'schedule', cronExpression: '0 9 * * *', timezone: 'UTC', missedRunPolicy: 'run_once', overlapPolicy: 'queue' }),
    );
    expect(scheduled.cronExpression).toBe('0 9 * * *');
    expect(scheduled.timezone).toBe('UTC');
    expect(scheduled.missedRunPolicy).toBe('run_once');
    expect(scheduled.overlapPolicy).toBe('queue');
  });
});


describe('automation codebases (D-103)', () => {
  it('sends the selected codebases with trimmed branches, only with a project', async () => {
    const { automationFormToParams, emptyAutomationForm } = await import('./automationFormSchema.js');
    const base = { ...emptyAutomationForm(), name: 'n', workflowIds: ['w'] };
    const withProject = automationFormToParams({ ...base, projectId: 'p', codebases: [{ alias: 'api', baseRef: ' release/2.0 ' }, { alias: 'web', baseRef: '' }] });
    expect(withProject.codebases).toEqual([{ alias: 'api', baseRef: 'release/2.0' }, { alias: 'web' }]);
    expect(automationFormToParams({ ...base, codebases: [{ alias: 'api' }] }).codebases).toBeUndefined();
    expect(automationFormToParams({ ...base, projectId: 'p' }).codebases).toBeUndefined();
  });

  it('toggles and edits a codebase in the project order', async () => {
    const { patchAutomationCodebase } = await import('./automationFormSchema.js');
    const order = ['api', 'web', 'docs'];
    let sel = patchAutomationCodebase([], order, 'docs', { selected: true });
    sel = patchAutomationCodebase(sel, order, 'api', { selected: true });
    expect(sel.map((c) => c.alias)).toEqual(['api', 'docs']);
    sel = patchAutomationCodebase(sel, order, 'api', { baseRef: 'dev' });
    expect(sel[0]).toEqual({ alias: 'api', baseRef: 'dev' });
    expect(patchAutomationCodebase(sel, order, 'api', { selected: false })).toEqual([{ alias: 'docs' }]);
  });
});

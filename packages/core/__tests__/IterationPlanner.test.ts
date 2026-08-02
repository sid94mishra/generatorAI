// ────────────────────────────────────────────────────────────────
// IterationPlanner tests (Track C)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { planIterations, previewIterations } from '../src/services/IterationPlanner.js';
import type {
  DataSchema,
  IterationMode,
  AutomationDataset,
} from '@generatorai/shared';

const schema: DataSchema = {
  version: 1,
  format: 'json_array',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'priority', type: 'string', required: false },
    { name: 'estimate', type: 'number', required: false },
  ],
  primaryKey: 'id',
};

const jsonDataset: AutomationDataset = {
  format: 'json_array',
  data: JSON.stringify([
    { id: 'a', priority: 'high', estimate: 3 },
    { id: 'b', priority: 'low', estimate: 5 },
    { id: 'c', priority: 'high', estimate: 2 },
  ]),
};

describe('planIterations', () => {
  it('produces one iteration per row in each_row mode', () => {
    const plan = planIterations({
      schema,
      mode: { kind: 'each_row' },
      dataset: jsonDataset,
    });
    expect(plan.iterations).toHaveLength(3);
    expect(plan.parsedRowCount).toBe(3);
    expect(plan.iterations[0]!.variables['id']).toBe('a');
    expect(plan.iterations[0]!.variables['__iteration_index']).toBe(0);
    expect(plan.iterations[0]!.variables['__iteration_total']).toBe(3);
    expect(plan.iterations[0]!.label).toBe('id=a');
  });

  it('groups rows in group_by mode', () => {
    const plan = planIterations({
      schema,
      mode: { kind: 'group_by', fields: ['priority'] },
      dataset: jsonDataset,
    });
    expect(plan.iterations).toHaveLength(2);
    expect(plan.iterations[0]!.variables['priority']).toBe('high');
    expect(plan.iterations[0]!.variables['items']).toHaveLength(2);
  });

  it('supplies a custom groupVariable when provided', () => {
    const mode: IterationMode = {
      kind: 'group_by',
      fields: ['priority'],
      groupVariable: 'tickets',
    };
    const plan = planIterations({ schema, mode, dataset: jsonDataset });
    expect(plan.iterations[0]!.variables['tickets']).toBeInstanceOf(Array);
    expect(plan.iterations[0]!.variables['items']).toBeUndefined();
  });

  it('produces exactly one iteration in single mode', () => {
    const plan = planIterations({
      schema,
      mode: { kind: 'single', datasetVariable: 'batch' },
      dataset: jsonDataset,
    });
    expect(plan.iterations).toHaveLength(1);
    expect(plan.iterations[0]!.variables['batch']).toHaveLength(3);
  });

  it('rejects rows missing a required field', () => {
    const bad: AutomationDataset = {
      format: 'json_array',
      data: JSON.stringify([{ priority: 'high' }]),
    };
    expect(() => planIterations({ schema, mode: { kind: 'each_row' }, dataset: bad })).toThrow(
      /missing required field "id"/,
    );
  });

  it('coerces string numbers to number type', () => {
    const csvSchema: DataSchema = {
      version: 1,
      format: 'csv',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'estimate', type: 'number', required: false },
      ],
    };
    const csv: AutomationDataset = {
      format: 'csv',
      data: 'id,estimate\nabc,3\ndef,7',
    };
    const plan = planIterations({ schema: csvSchema, mode: { kind: 'each_row' }, dataset: csv });
    expect(plan.iterations[0]!.variables['estimate']).toBe(3);
    expect(plan.iterations[1]!.variables['estimate']).toBe(7);
  });

  it('rejects an unknown group_by field', () => {
    expect(() =>
      planIterations({
        schema,
        mode: { kind: 'group_by', fields: ['nonexistent'] },
        dataset: jsonDataset,
      }),
    ).toThrow(/group_by field "nonexistent"/);
  });

  it('respects string enum constraint', () => {
    const enumSchema: DataSchema = {
      version: 1,
      format: 'json_array',
      fields: [
        { name: 'priority', type: 'string', required: true, enum: ['high', 'low'] },
      ],
    };
    const bad: AutomationDataset = {
      format: 'json_array',
      data: JSON.stringify([{ priority: 'critical' }]),
    };
    expect(() =>
      planIterations({ schema: enumSchema, mode: { kind: 'each_row' }, dataset: bad }),
    ).toThrow(/must be one of \[high, low\]/);
  });

  it('rejects reserved-key overrides silently by ignoring them', () => {
    const naughty: AutomationDataset = {
      format: 'json_array',
      data: JSON.stringify([
        { id: 'a', __iteration_index: 99, __proto__: { polluted: true } },
      ]),
    };
    const plan = planIterations({ schema, mode: { kind: 'each_row' }, dataset: naughty });
    // Reserved iteration-index is not overwritten from row.
    expect(plan.iterations[0]!.variables['__iteration_index']).toBe(0);
  });

  it('merges base variables under row-level values', () => {
    const plan = planIterations({
      schema,
      mode: { kind: 'each_row' },
      dataset: jsonDataset,
      baseVariables: { region: 'us-east', priority: 'from-base' },
    });
    expect(plan.iterations[0]!.variables['region']).toBe('us-east');
    // Row's priority wins over baseVariables.
    expect(plan.iterations[0]!.variables['priority']).toBe('high');
  });

  it('previewIterations caps returned iterations to 5', () => {
    const bigData = Array.from({ length: 20 }, (_, i) => ({ id: `row${i}` }));
    const preview = previewIterations({
      schema,
      mode: { kind: 'each_row' },
      dataset: { format: 'json_array', data: JSON.stringify(bigData) },
    });
    expect(preview.iterations).toHaveLength(5);
    expect(preview.totalIterations).toBe(20);
    expect(preview.parsedRowCount).toBe(20);
  });

  it('rejects an empty dataset (parseBatchData surfaces the error)', () => {
    expect(() =>
      planIterations({
        schema,
        mode: { kind: 'each_row' },
        dataset: { format: 'json_array', data: '[]' },
      }),
    ).toThrow(/at least one row/);
  });

  it('rejects group_by with an unknown groupVariable that is not a valid identifier', () => {
    expect(() =>
      planIterations({
        schema,
        mode: { kind: 'group_by', fields: ['priority'], groupVariable: '__proto__' },
        dataset: jsonDataset,
      }),
    ).toThrow(/Invalid groupVariable/);
  });

  it('coerces boolean-like strings', () => {
    const boolSchema: DataSchema = {
      version: 1,
      format: 'csv',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'active', type: 'boolean', required: true },
      ],
    };
    const csv = 'id,active\na,true\nb,false\nc,1\nd,no';
    const plan = planIterations({
      schema: boolSchema,
      mode: { kind: 'each_row' },
      dataset: { format: 'csv', data: csv },
    });
    expect(plan.iterations[0]!.variables['active']).toBe(true);
    expect(plan.iterations[1]!.variables['active']).toBe(false);
    expect(plan.iterations[2]!.variables['active']).toBe(true);
    expect(plan.iterations[3]!.variables['active']).toBe(false);
  });

  it('rejects malformed number values', () => {
    const numSchema: DataSchema = {
      version: 1,
      format: 'json_array',
      fields: [
        { name: 'n', type: 'number', required: true },
      ],
    };
    const bad = JSON.stringify([{ n: 'not-a-number' }]);
    expect(() =>
      planIterations({
        schema: numSchema,
        mode: { kind: 'each_row' },
        dataset: { format: 'json_array', data: bad },
      }),
    ).toThrow(/is not a number/);
  });
});

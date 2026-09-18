import { describe, expect, it } from 'vitest';

import { buildVariables, initialDraft, parseVariables } from '../components/work/variableForm';

const RAW = [
  { name: 'repo', type: 'string', label: 'Repository', required: true },
  { name: 'count', type: 'number', label: 'Count', defaultValue: 3 },
  { name: 'dryRun', type: 'boolean', label: 'Dry run', defaultValue: true },
  { name: 'env', type: 'choice', label: 'Environment', required: true, options: ['staging', 'prod'] },
  { name: 'notes', type: 'text', label: 'Notes' },
  { name: '__projectId', type: 'string', label: 'internal' },
  { type: 'string', label: 'nameless' },
  'garbage',
];

describe('parseVariables', () => {
  it('keeps real inputs and drops internal or malformed entries', () => {
    const defs = parseVariables(RAW);
    expect(defs.map((d) => d.name)).toEqual(['repo', 'count', 'dryRun', 'env', 'notes']);
    expect(parseVariables(undefined)).toEqual([]);
    expect(parseVariables([{ name: 'x', type: 'weird' }])[0]).toMatchObject({ type: 'string', label: 'x' });
  });
});

describe('initialDraft', () => {
  it('applies defaults and preselects a required choice', () => {
    expect(initialDraft(parseVariables(RAW))).toEqual({
      repo: '',
      count: '3',
      dryRun: true,
      env: 'staging',
      notes: '',
    });
  });
});

describe('buildVariables', () => {
  const defs = parseVariables(RAW);

  it('reports required and type errors per field', () => {
    const result = buildVariables(defs, { repo: '  ', count: 'abc', dryRun: false, env: 'qa', notes: '' });
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(['count', 'env', 'repo']);
  });

  it('coerces a valid draft and omits blank optional fields', () => {
    const result = buildVariables(defs, {
      repo: ' acme/app ',
      count: '5',
      dryRun: false,
      env: 'prod',
      notes: '',
    });
    expect(result.valid).toBe(true);
    expect(result.variables).toEqual({ repo: 'acme/app', count: 5, dryRun: false, env: 'prod' });
  });

  it('keeps text whitespace verbatim', () => {
    const result = buildVariables(defs, { repo: 'r', count: '', dryRun: true, env: 'prod', notes: 'line 1\n  line 2' });
    expect(result.variables['notes']).toBe('line 1\n  line 2');
    expect('count' in result.variables).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { VariableDefinition } from '@generatorai/workflow-spec';

import { defaultPreview, defaultText, parseDefault, retype, variableNameProblem, variableSummary } from '../settings/workflowSettingsModel';

const v = (extra: Partial<VariableDefinition>): VariableDefinition => ({ name: 'x', type: 'string', label: 'X', required: false, ...extra });

describe('workflow settings model (MDF-89)', () => {
  it('checks variable names', () => {
    expect(variableNameProblem('run', [])).toBe('run is reserved. Pick another name.');
    expect(variableNameProblem('repo_path_api', [])).toMatch(/reserved/);
    expect(variableNameProblem('2x', [])).toMatch(/Letters/);
    expect(variableNameProblem('target_branch', ['target_branch'])).toMatch(/already/);
    expect(variableNameProblem('target_branch', [])).toBeNull();
  });

  it('parses defaults per type and keeps what fits on a type change', () => {
    expect(parseDefault('number', '3')).toEqual({ value: 3 });
    expect(parseDefault('number', 'x')).toEqual({ error: 'Not a number' });
    expect(parseDefault('list', 'a\n b\n\n')).toEqual({ value: ['a', 'b'] });
    expect(parseDefault('json', '{"a":1}')).toEqual({ value: { a: 1 } });
    expect(parseDefault('choice', 'yarn', ['npm', 'pnpm'])).toEqual({ error: 'Not one of the options' });
    expect(parseDefault('string', '')).toEqual({});
    expect(retype(v({ defaultValue: '3' }), 'number').defaultValue).toBe(3);
    expect('defaultValue' in retype(v({ defaultValue: 'main' }), 'number')).toBe(false);
    expect(retype(v({ defaultValue: 'a, b' }), 'list').defaultValue).toEqual(['a', 'b']);
  });

  it('summarises rows', () => {
    expect(variableSummary(v({ required: true }))).toBe('String · required');
    expect(defaultPreview(v({ type: 'list', defaultValue: ['left-pad', 'is-odd'] }))).toBe('left-pad, is-odd');
    expect(defaultText(v({ type: 'list', defaultValue: ['a', 'b'] }))).toBe('a\nb');
    expect(defaultPreview(v({}))).toBeNull();
  });
});

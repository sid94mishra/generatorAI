// The run form asks for a variable by its LABEL. A variable renamed from the
// generated `variable1` to something meaningful used to keep asking for
// "Variable 1", which tells whoever starts the run nothing at all.

import { describe, expect, it } from 'vitest';
import { isAutoLabel, parseOptions, variableNameError } from '@/components/workflow/settings/VariablesTab.js';

describe('isAutoLabel', () => {
  it('recognises the label generated alongside the name', () => {
    expect(isAutoLabel('Variable 1', 'variable1')).toBe(true);
    expect(isAutoLabel('Variable 12', 'variable12')).toBe(true);
  });

  it('treats a missing label, or one equal to the name, as automatic', () => {
    expect(isAutoLabel(undefined, 'module')).toBe(true);
    expect(isAutoLabel('', 'module')).toBe(true);
    expect(isAutoLabel('module', 'module')).toBe(true);
  });

  it('never overwrites a label the user wrote', () => {
    expect(isAutoLabel('Target module', 'variable1')).toBe(false);
    expect(isAutoLabel('Variable 2', 'variable1')).toBe(false);
    expect(isAutoLabel('Variable 1', 'module')).toBe(false);
  });
});

describe('Variables tab parsing', () => {
  it('choice options are parsed from the raw string (D-11)', () => {
    expect(parseOptions('a, b,,c , a')).toEqual(['a', 'b', 'c']);
    expect(parseOptions(' ')).toEqual([]);
  });

  it('rejects reserved and invalid names inline', () => {
    expect(variableNameError('module', [])).toBeNull();
    expect(variableNameError('variables', [])).toMatch(/reserved expression root/);
    expect(variableNameError('run', [])).toMatch(/reserved expression root/);
    expect(variableNameError('__secret', [])).toMatch(/reserved/);
    expect(variableNameError('repo_path_api', [])).toMatch(/reserved/);
    expect(variableNameError('1st', [])).toMatch(/letters, digits/);
    expect(variableNameError('dup', ['dup'])).toMatch(/already called/);
    expect(variableNameError('', [])).toMatch(/required/);
  });
});

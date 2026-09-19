// The run form asks for a variable by its LABEL. A variable renamed from the
// generated `variable1` to something meaningful used to keep asking for
// "Variable 1", which tells whoever starts the run nothing at all.

import { describe, expect, it } from 'vitest';
import { isAutoLabel } from '@/components/workflow/settings/VariablesTab.js';

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

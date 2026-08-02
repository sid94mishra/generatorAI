import { describe, it, expect } from 'vitest';
import { resolveAvailableTools } from '../src/providers/copilot/CopilotProvider.js';

// Guards the fix: an empty/absent availableTools whitelist must mean
// "all built-in tools enabled" (undefined), NOT "zero tools". Treating `[]`
// as a literal allow-list disabled file/edit/bash and forced markdown output.
describe('resolveAvailableTools (Copilot whitelist semantics)', () => {
  it('undefined → undefined (no restriction)', () => {
    expect(resolveAvailableTools(undefined)).toBeUndefined();
  });
  it('empty array → undefined (no restriction, NOT zero tools)', () => {
    expect(resolveAvailableTools([])).toBeUndefined();
  });
  it("wildcard ['*'] → undefined (all tools)", () => {
    expect(resolveAvailableTools(['*'])).toBeUndefined();
  });
  it('wildcard mixed with names → undefined (wildcard wins)', () => {
    expect(resolveAvailableTools(['create', '*'])).toBeUndefined();
  });
  it('a real non-empty list is forwarded as a restriction', () => {
    expect(resolveAvailableTools(['create', 'edit'])).toEqual(['create', 'edit']);
  });
});

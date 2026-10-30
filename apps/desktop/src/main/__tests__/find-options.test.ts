import { describe, expect, it } from 'vitest';
import { findInPageOptions } from '../find-options';

describe('findInPageOptions', () => {
  it('starts a new Electron find session for a new query', () => {
    expect(findInPageOptions({ forward: true })).toEqual({ forward: true, findNext: true });
  });
  it('steps through the current session for next / previous (findNext omitted)', () => {
    expect(findInPageOptions({ forward: true, findNext: true })).toEqual({ forward: true });
    expect(findInPageOptions({ forward: false, findNext: true })).toEqual({ forward: false });
  });
});

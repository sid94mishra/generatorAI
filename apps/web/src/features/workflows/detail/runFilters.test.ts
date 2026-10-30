import { describe, expect, it } from 'vitest';
import { EMPTY_RUN_FILTERS, activeFilterCount, parseVariableFilter, toRunListFilter } from './runFilters.js';

describe('run filters', () => {
  it('sends nothing but the base when empty', () => {
    expect(toRunListFilter(EMPTY_RUN_FILTERS, { definitionId: 'd' })).toEqual({ definitionId: 'd' });
    expect(activeFilterCount(EMPTY_RUN_FILTERS)).toBe(0);
  });

  it('maps every filter, with inclusive local days', () => {
    const f = {
      q: '  nightly ',
      statuses: ['failed'],
      triggers: ['automation'],
      from: '2026-09-01',
      to: '2026-09-02',
      variables: [{ name: 'branch', value: 'main' }],
    };
    const out = toRunListFilter(f);
    expect(out).toMatchObject({ q: 'nightly', status: ['failed'], trigger: ['automation'], variables: { branch: 'main' } });
    expect(new Date(out.from!).getTime()).toBe(new Date(2026, 8, 1).getTime());
    expect(new Date(out.to!).getTime()).toBe(new Date(2026, 8, 2, 23, 59, 59, 999).getTime());
    expect(activeFilterCount(f)).toBe(5);
  });

  it('parses name=value', () => {
    expect(parseVariableFilter(' branch = main ')).toEqual({ name: 'branch', value: 'main' });
    expect(parseVariableFilter('nope')).toBeNull();
  });
});

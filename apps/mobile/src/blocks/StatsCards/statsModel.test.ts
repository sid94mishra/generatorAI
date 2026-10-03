import { describe, expect, it } from 'vitest';
import type { StatsSummary } from '@generatorai/shared';

import { automationStatItems, formatDurationShort, serverFooterDetail, weekStatItems } from './statsModel';

const summary = (runs: Partial<StatsSummary['runs']> = {}, extra: Partial<StatsSummary> = {}): StatsSummary => ({
  range: { from: 'a', to: 'b' },
  chats: { created: 41 },
  runs: { total: 128, succeeded: 120, failed: 6, cancelled: 2, ...runs },
  ...extra,
});

describe('weekStatItems', () => {
  it('renders the four cells when the server has rates', () => {
    expect(weekStatItems(summary({ successRate: 0.9375, avgDurationMs: 372_000 })).map((i) => [i.label, i.value])).toEqual([
      ['Chats', 41],
      ['Runs', 128],
      ['Succeeded', '94%'],
      ['Avg run', '6m 12s'],
    ]);
  });
  it('omits an absent rate or average instead of showing a dash (NG-03, MD-27)', () => {
    expect(weekStatItems(summary()).map((i) => i.id)).toEqual(['chats', 'runs']);
  });
});

describe('automationStatItems', () => {
  it('derives the success rate from executions, never from zero', () => {
    expect(automationStatItems(summary({}, { automations: { executions: 4, succeeded: 3, avgDurationMs: 45_000 } })).map((i) => i.value)).toEqual([4, '75%', '45s']);
    expect(automationStatItems(summary({}, { automations: { executions: 0, succeeded: 0 } })).map((i) => i.id)).toEqual(['runs']);
    expect(automationStatItems(summary())).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats durations and the footer detail', () => {
    expect(formatDurationShort(3_780_000)).toBe('1h 3m');
    expect(formatDurationShort(60_000)).toBe('1m');
    expect(serverFooterDetail('local:3100', { serverVersion: '0.0.1-alpha.1' })).toBe('local:3100 · 0.0.1-alpha.1');
    expect(serverFooterDetail(null, { serverVersion: 'unknown' })).toBe('');
  });
});

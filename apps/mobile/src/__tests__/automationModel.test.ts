import { describe, expect, it } from 'vitest';

import {
  absoluteLabel,
  executionIdOf,
  executionPollInterval,
  isExecutionActive,
  makeIdempotencyKey,
  nextRunLabel,
  sortExecutions,
  toMs,
  triggeredByLabel,
} from '../features/automations/model';

// Monday 14 Sep 2026, 10:00 local time.
const NOW = new Date(2026, 8, 14, 10, 0, 0).getTime();
const plus = (minutes: number) => NOW + minutes * 60_000;

describe('toMs', () => {
  it('accepts ISO strings and epoch ms, rejects junk', () => {
    expect(toMs(NOW)).toBe(NOW);
    expect(toMs(new Date(NOW).toISOString())).toBe(NOW);
    expect(toMs('nope')).toBeNull();
    expect(toMs(undefined)).toBeNull();
    expect(toMs(Number.NaN)).toBeNull();
  });
});

describe('nextRunLabel', () => {
  it('is null when nothing is scheduled', () => {
    expect(nextRunLabel(null, NOW)).toBeNull();
    expect(nextRunLabel(undefined, NOW)).toBeNull();
  });

  it('treats overdue and imminent slots as due now', () => {
    expect(nextRunLabel(plus(-5), NOW)).toBe('Next run due now');
    expect(nextRunLabel(NOW + 30_000, NOW)).toBe('Next run due now');
  });

  it('combines a relative and an absolute time', () => {
    expect(nextRunLabel(plus(25), NOW)).toBe('Next run in 25m · today 10:25');
    expect(nextRunLabel(plus(150), NOW)).toBe('Next run in 2h 30m · today 12:30');
    expect(nextRunLabel(plus(120), NOW)).toBe('Next run in 2h · today 12:00');
    expect(nextRunLabel(new Date(plus(23 * 60)).toISOString(), NOW)).toBe(
      'Next run in 23h · tomorrow 09:00',
    );
  });

  it('uses weekday within a week and a date beyond', () => {
    expect(absoluteLabel(new Date(2026, 8, 17, 9, 5).getTime(), NOW)).toBe('Thu 09:05');
    expect(absoluteLabel(new Date(2026, 9, 2, 18, 0).getTime(), NOW)).toBe('2 Oct 18:00');
    expect(nextRunLabel(new Date(2026, 8, 17, 9, 5).getTime(), NOW)).toBe('Next run in 2d · Thu 09:05');
  });
});

describe('executions', () => {
  it('treats pending and running as active', () => {
    expect(isExecutionActive('pending')).toBe(true);
    expect(isExecutionActive('running')).toBe(true);
    expect(isExecutionActive('completed')).toBe(false);
    expect(isExecutionActive('partial')).toBe(false);
  });

  it('sorts newest first and polls only while active', () => {
    const list = [
      { id: 'old', status: 'completed', startedAt: new Date(plus(-60)).toISOString() },
      { id: 'none', status: 'failed' },
      { id: 'new', status: 'running', createdAt: plus(-1) },
    ];
    expect(sortExecutions(list).map((e) => e.id)).toEqual(['new', 'old', 'none']);
    expect(executionPollInterval(list)).toBe(5_000);
    expect(executionPollInterval([{ status: 'completed' }])).toBe(false);
    expect(executionPollInterval(undefined)).toBe(false);
  });

  it('reads the execution id from a trigger response or replay', () => {
    expect(executionIdOf({ id: 'e1', status: 'pending' })).toBe('e1');
    expect(executionIdOf({ id: 'e2', status: 'pending', replay: true })).toBe('e2');
    expect(executionIdOf({})).toBeNull();
    expect(executionIdOf(undefined)).toBeNull();
  });
});

describe('makeIdempotencyKey', () => {
  it('is deterministic with injected clock and randomness', () => {
    expect(makeIdempotencyKey('auto1', () => 1_000, () => 0)).toBe('auto1:1000:0000000');
    const a = makeIdempotencyKey('auto1', () => 1_000, () => 0.5);
    const b = makeIdempotencyKey('auto1', () => 1_000, () => 0.25);
    expect(a).not.toBe(b);
    expect(a.startsWith('auto1:1000:')).toBe(true);
  });
});

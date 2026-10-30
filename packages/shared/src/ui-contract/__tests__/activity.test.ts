import { describe, expect, it } from 'vitest';
import { ACTIVITY_GROUPS, ACTIVITY_KIND_META, ACTIVITY_KINDS, describeSchedule } from '../activity.js';

describe('activity vocabulary (D-92)', () => {
  it('orders the column actionable first and names every kind', () => {
    expect(ACTIVITY_GROUPS).toEqual(['needs_you', 'failed', 'running', 'recent']);
    for (const kind of ACTIVITY_KINDS) expect(ACTIVITY_KIND_META[kind].icon).toBeTruthy();
  });

  it.each([
    ['0 * * * *', 'every hour'],
    ['*/15 * * * *', 'every 15 min'],
    ['* * * * *', 'every minute'],
    ['0 */6 * * *', 'every 6 h'],
    ['0 2 * * *', 'daily at 02:00'],
    ['30 9 * * 1-5', 'weekdays at 09:30'],
    ['0 9 * * 1', 'Mondays at 09:00'],
    ['0 9 * * 7', 'Sundays at 09:00'],
  ])('describes %s as "%s"', (cron, words) => {
    expect(describeSchedule(cron)).toBe(words);
  });

  it('returns anything it does not recognise as written', () => {
    expect(describeSchedule('0 9 1 * *')).toBe('0 9 1 * *');
    expect(describeSchedule('0 9 * * 1,3')).toBe('0 9 * * 1,3');
    expect(describeSchedule('@daily')).toBe('@daily');
  });
});

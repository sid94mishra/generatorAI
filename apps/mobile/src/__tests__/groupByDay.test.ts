import { describe, expect, it } from 'vitest';

import { dayBucket, sectionRows } from '../components/common/groupByDay';

// A Wednesday mid-afternoon, local time.
const NOW = new Date(2026, 8, 16, 15, 0, 0).getTime();
const at = (daysAgo: number, hour = 12) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

describe('dayBucket', () => {
  it('uses local calendar days, not rolling 24h windows', () => {
    expect(dayBucket(at(0, 0), NOW)).toBe('today');
    expect(dayBucket(at(1, 23), NOW)).toBe('yesterday');
    expect(dayBucket(at(1, 0), NOW)).toBe('yesterday');
    expect(dayBucket(at(2), NOW)).toBe('week');
    expect(dayBucket(at(6), NOW)).toBe('week');
    expect(dayBucket(at(7), NOW)).toBe('older');
  });

  it('treats a slightly future time as today and an unknown one as older', () => {
    expect(dayBucket(NOW + 5000, NOW)).toBe('today');
    expect(dayBucket(null, NOW)).toBe('older');
    expect(dayBucket(Number.NaN, NOW)).toBe('older');
  });
});

describe('sectionRows', () => {
  const items = [
    { id: 'a', t: at(0), active: false },
    { id: 'b', t: at(0), active: true },
    { id: 'c', t: at(1), active: false },
    { id: 'd', t: at(30), active: false },
  ];
  const base = { keyOf: (i: (typeof items)[number]) => i.id, timeOf: (i: (typeof items)[number]) => i.t, now: NOW };

  it('emits a header before each non-empty section, in order, keeping item order', () => {
    const rows = sectionRows(items, base);
    expect(rows.map((r) => (r.type === 'header' ? `#${r.label}:${r.count}` : r.key))).toEqual([
      '#Today:2',
      'a',
      'b',
      '#Yesterday:1',
      'c',
      '#Older:1',
      'd',
    ]);
  });

  it('pulls pinned items into a leading section', () => {
    const rows = sectionRows(items, { ...base, pinned: { label: 'Active', test: (i) => i.active } });
    expect(rows.map((r) => (r.type === 'header' ? `#${r.label}` : r.key))).toEqual([
      '#Active',
      'b',
      '#Today',
      'a',
      '#Yesterday',
      'c',
      '#Older',
      'd',
    ]);
  });

  it('has unique keys and nothing for an empty list', () => {
    const rows = sectionRows(items, base);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(sectionRows([], base)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────
// Date sections for history lists — Today / Yesterday / This week / Older.
//
// Calendar days in the phone's local time (midnight boundaries), not rolling
// 24h windows: "Yesterday" has to mean the day before today on the wall
// clock, or a chat from 23:50 last night reads as "Today" at 00:10.
//
// `sectionRows` flattens items and headers into ONE array so a virtualised
// list (LegendList) can render both with `getItemType`, and keeps the input
// order inside each section — callers sort first.
//
// Pure, tested in src/__tests__/groupByDay.test.ts.
// ────────────────────────────────────────────────────────────────

export type DayBucket = 'today' | 'yesterday' | 'week' | 'older';

export const DAY_BUCKET_LABEL: Record<DayBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  older: 'Older',
};

const ORDER: readonly DayBucket[] = ['today', 'yesterday', 'week', 'older'];

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Which bucket a timestamp belongs to. Unknown or future times count as
 * today (clock skew between phone and server makes "just now" slightly
 * future), never as "Older".
 */
export function dayBucket(at: number | null | undefined, now: number = Date.now()): DayBucket {
  if (typeof at !== 'number' || !Number.isFinite(at)) return 'older';
  const today = startOfLocalDay(now);
  if (at >= today) return 'today';
  const yesterday = startOfLocalDay(today - 1);
  if (at >= yesterday) return 'yesterday';
  // "This week" = the five days before yesterday (a rolling week), so the
  // section never empties out on a Monday.
  const weekStart = startOfLocalDay(today - 6 * 24 * 60 * 60 * 1000);
  if (at >= weekStart) return 'week';
  return 'older';
}

export type SectionRow<T> =
  | { type: 'header'; key: string; label: string; count: number }
  | { type: 'item'; key: string; item: T };

export interface SectionOptions<T> {
  /** Stable key for an item row. */
  keyOf: (item: T) => string;
  /** Epoch ms for an item (`null` when unknown). */
  timeOf: (item: T) => number | null;
  now?: number;
  /**
   * Items that belong in a leading section regardless of date — "Needs you"
   * and "Running" on the runs list. Rendered first, in input order.
   */
  pinned?: { label: string; key?: string; test: (item: T) => boolean };
}

export function sectionRows<T>(items: readonly T[], options: SectionOptions<T>): SectionRow<T>[] {
  const now = options.now ?? Date.now();
  const pinned: T[] = [];
  const buckets: Record<DayBucket, T[]> = { today: [], yesterday: [], week: [], older: [] };

  for (const item of items) {
    if (options.pinned?.test(item)) pinned.push(item);
    else buckets[dayBucket(options.timeOf(item), now)].push(item);
  }

  const rows: SectionRow<T>[] = [];
  const push = (key: string, label: string, list: T[]) => {
    if (list.length === 0) return;
    rows.push({ type: 'header', key: `section:${key}`, label, count: list.length });
    for (const item of list) rows.push({ type: 'item', key: options.keyOf(item), item });
  };

  if (options.pinned) push(options.pinned.key ?? 'pinned', options.pinned.label, pinned);
  for (const bucket of ORDER) push(bucket, DAY_BUCKET_LABEL[bucket], buckets[bucket]);
  return rows;
}

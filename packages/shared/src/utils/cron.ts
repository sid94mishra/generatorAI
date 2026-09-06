// ────────────────────────────────────────────────────────────────
// cron — ONE rule set for validating and firing 5-field cron
//   expressions, shared by the API validator (AutomationSchemas) and
//   the scheduler (AutomationService). Before this the API accepted a
//   digits-only regex and the executor used node-cron's parser, so an
//   expression could be accepted and never fire (`99 99 99 99 99`) or
//   be perfectly valid and rejected at save (`0 9 * * MON-FRI`).
//
// Grammar (vixie-cron):
//   minute(0-59) hour(0-23) day-of-month(1-31) month(1-12|JAN-DEC)
//   day-of-week(0-7|SUN-SAT, 7 == SUN)
//   field := * | list ; list := range(,range)* ; range := (n|n-m|*)(/step)?
//   day-of-month and day-of-week are OR'd when BOTH are restricted.
//
// Timezones are IANA names resolved through `Intl`, which every
// supported Node and browser ships with full tz data.
// ────────────────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: Record<string, number>;
}

const FIELDS: readonly FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTH_NAMES },
  { name: 'day-of-week', min: 0, max: 7, names: DAY_NAMES },
];

/** Parsed cron expression: one sorted set of allowed values per field. */
export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** Whether day-of-month / day-of-week were `*` (drives the OR rule). */
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
}

export type CronValidation =
  | { ok: true; parsed: ParsedCron }
  | { ok: false; error: string };

function parseValue(raw: string, spec: FieldSpec): number | null {
  const lower = raw.toLowerCase();
  if (spec.names && lower in spec.names) return spec.names[lower]!;
  if (!/^\d{1,2}$/.test(raw)) return null;
  return Number(raw);
}

function parseField(raw: string, spec: FieldSpec): { values: Set<number>; any: boolean } | string {
  const values = new Set<number>();
  let any = false;
  for (const item of raw.split(',')) {
    if (item === '') return `${spec.name}: empty list element in "${raw}"`;
    const [rangePart, stepPart, ...rest] = item.split('/');
    if (rest.length > 0 || stepPart === '') return `${spec.name}: malformed step in "${item}"`;
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d{1,2}$/.test(stepPart) || Number(stepPart) === 0) {
        return `${spec.name}: step must be a positive integer in "${item}"`;
      }
      step = Number(stepPart);
    }
    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = spec.min;
      hi = spec.max;
      if (stepPart === undefined) any = true;
    } else {
      const bounds = rangePart!.split('-');
      if (bounds.length > 2 || bounds[0] === '') return `${spec.name}: malformed range "${item}"`;
      const a = parseValue(bounds[0]!, spec);
      if (a === null) return `${spec.name}: "${bounds[0]}" is not a valid value`;
      lo = a;
      if (bounds.length === 2) {
        if (bounds[1] === '') return `${spec.name}: malformed range "${item}"`;
        const b = parseValue(bounds[1]!, spec);
        if (b === null) return `${spec.name}: "${bounds[1]}" is not a valid value`;
        hi = b;
      } else if (stepPart !== undefined) {
        // `5/10` means "starting at 5, every 10" up to max (vixie).
        hi = spec.max;
      } else {
        hi = a;
      }
    }
    if (lo < spec.min || lo > spec.max) return `${spec.name}: ${lo} is out of range ${spec.min}-${spec.max}`;
    if (hi < spec.min || hi > spec.max) return `${spec.name}: ${hi} is out of range ${spec.min}-${spec.max}`;
    if (lo > hi) return `${spec.name}: range start ${lo} is after end ${hi}`;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, any };
}

/**
 * Validate a 5-field cron expression. Returns the parsed field sets on
 * success so the scheduler and the validator share one interpretation.
 */
export function validateCronExpression(expression: string): CronValidation {
  if (typeof expression !== 'string') return { ok: false, error: 'cron expression must be a string' };
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      ok: false,
      error: `expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`,
    };
  }
  const sets: Array<{ values: Set<number>; any: boolean }> = [];
  for (let i = 0; i < 5; i++) {
    const res = parseField(parts[i]!, FIELDS[i]!);
    if (typeof res === 'string') return { ok: false, error: res };
    sets.push(res);
  }
  const dow = new Set<number>();
  for (const v of sets[4]!.values) dow.add(v === 7 ? 0 : v);
  return {
    ok: true,
    parsed: {
      minutes: sets[0]!.values,
      hours: sets[1]!.values,
      daysOfMonth: sets[2]!.values,
      months: sets[3]!.values,
      daysOfWeek: dow,
      anyDayOfMonth: sets[2]!.any,
      anyDayOfWeek: sets[4]!.any,
    },
  };
}

/** True when `tz` is an IANA zone this runtime can resolve. */
export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ── Wall-clock arithmetic in a zone ─────────────────────────────

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

function wallClock(instant: Date, tz: string): WallClock {
  const parts = formatterFor(tz).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  // `hourCycle: 'h23'` still yields "24" on some ICU builds for midnight.
  const hour = Number(get('hour')) % 24;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

/** Offset (ms) of `tz` from UTC at `instant`: wall − utc. */
function tzOffsetMs(instant: Date, tz: string): number {
  const w = wallClock(instant, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, 0, 0);
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return asUtc - truncated;
}

/**
 * Convert a wall-clock time in `tz` to a UTC instant. Around a DST gap
 * (a wall time that never happens) this lands on the first instant after
 * the gap; in an overlap it picks the earlier instant. Both are what
 * cron users expect ("run at 2:30" during spring-forward fires at 3:00).
 */
function wallToUtc(w: { year: number; month: number; day: number; hour: number; minute: number }, tz: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, 0, 0);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let result = guess - off1;
  const off2 = tzOffsetMs(new Date(result), tz);
  if (off2 !== off1) result = guess - off2;
  return new Date(result);
}

function matchesDay(parsed: ParsedCron, w: WallClock): boolean {
  const domOk = parsed.daysOfMonth.has(w.day);
  const dowOk = parsed.daysOfWeek.has(w.weekday);
  if (parsed.anyDayOfMonth && parsed.anyDayOfWeek) return true;
  if (parsed.anyDayOfMonth) return dowOk;
  if (parsed.anyDayOfWeek) return domOk;
  return domOk || dowOk;
}

/** Hard cap so a never-matching expression (Feb 31) cannot spin forever. */
const MAX_SEARCH_STEPS = 100_000;

/**
 * The next instant strictly after `from` at which `expression` fires,
 * evaluated on the wall clock of `timezone` (defaults to the process
 * zone). Throws when no occurrence exists within ~8 years.
 */
export function getNextCronRun(
  expression: string | ParsedCron,
  from: Date,
  timezone?: string,
): Date {
  const parsed = typeof expression === 'string' ? mustParse(expression) : expression;
  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Start at the next whole minute strictly after `from`.
  let t = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  const horizon = from.getTime() + 8 * 366 * 24 * 60 * 60_000;

  for (let steps = 0; steps < MAX_SEARCH_STEPS && t.getTime() <= horizon; steps++) {
    const w = wallClock(t, tz);
    if (!parsed.months.has(w.month)) {
      const next = w.month === 12
        ? { year: w.year + 1, month: 1, day: 1, hour: 0, minute: 0 }
        : { year: w.year, month: w.month + 1, day: 1, hour: 0, minute: 0 };
      t = wallToUtc(next, tz);
      continue;
    }
    if (!matchesDay(parsed, w)) {
      // Advance to 00:00 of the next wall-clock day. Date.UTC normalises
      // day overflow (Jan 32 → Feb 1) for us.
      const n = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
      t = wallToUtc({ year: n.getUTCFullYear(), month: n.getUTCMonth() + 1, day: n.getUTCDate(), hour: 0, minute: 0 }, tz);
      continue;
    }
    if (!parsed.hours.has(w.hour)) {
      const n = new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour + 1));
      t = wallToUtc({ year: n.getUTCFullYear(), month: n.getUTCMonth() + 1, day: n.getUTCDate(), hour: n.getUTCHours(), minute: 0 }, tz);
      continue;
    }
    if (!parsed.minutes.has(w.minute)) {
      t = new Date(t.getTime() + 60_000);
      continue;
    }
    return t;
  }
  throw new Error('cron expression never matches within the next 8 years');
}

/**
 * Number of scheduled instants in the half-open window `(after, upTo]`,
 * capped at `limit`. Used to report "missed N runs while offline".
 */
export function countCronRunsBetween(
  expression: string | ParsedCron,
  after: Date,
  upTo: Date,
  timezone?: string,
  limit = 1000,
): number {
  const parsed = typeof expression === 'string' ? mustParse(expression) : expression;
  let count = 0;
  let cursor = after;
  while (count < limit) {
    let next: Date;
    try {
      next = getNextCronRun(parsed, cursor, timezone);
    } catch {
      break;
    }
    if (next.getTime() > upTo.getTime()) break;
    count++;
    cursor = next;
  }
  return count;
}

function mustParse(expression: string): ParsedCron {
  const v = validateCronExpression(expression);
  if (!v.ok) throw new Error(`Invalid cron expression "${expression}": ${v.error}`);
  return v.parsed;
}

// Schedule editing (MAutomationCreate2): the Repeats presets ↔ a 5-field cron, a light cron check, and the summary
// line ("Daily 02:00", "Weekdays 07:30", "Fridays 16:00"). Pure, unit-tested.

export type Repeats = 'daily' | 'weekdays' | 'weekly' | 'cron';

export interface ScheduleDraft {
  repeats: Repeats;
  /** 0–23 / 0–59 local to `timezone`. */
  hour: number;
  minute: number;
  /** Weekly: 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Cron: the raw expression. */
  cron: string;
  timezone: string;
}

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'] as const;

const pad = (n: number): string => String(n).padStart(2, '0');

export function scheduleToCron(s: ScheduleDraft): string {
  switch (s.repeats) {
    case 'daily':
      return `${s.minute} ${s.hour} * * *`;
    case 'weekdays':
      return `${s.minute} ${s.hour} * * 1-5`;
    case 'weekly':
      return `${s.minute} ${s.hour} * * ${[...new Set(s.days)].sort((a, b) => a - b).join(',') || '1'}`;
    case 'cron':
      return s.cron.trim();
  }
}

const FIELD = /^(\*|\*\/\d+|\d+(-\d+)?(\/\d+)?(,\d+(-\d+)?(\/\d+)?)*)$/;
const RANGES: ReadonlyArray<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

/** A 5-field cron the scheduler accepts (numbers, ranges, steps, lists); the server has the final say. */
export function cronProblem(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 'A cron has five fields: minute hour day month weekday.';
  for (let i = 0; i < 5; i++) {
    const field = parts[i]!;
    if (!FIELD.test(field)) return `Field ${i + 1} (“${field}”) isn't a number, range, step or *.`;
    const [lo, hi] = RANGES[i]!;
    for (const n of field.match(/\d+/g) ?? []) {
      const value = Number(n);
      if (field.includes(`/${n}`) && field.indexOf(`/${n}`) === field.length - n.length - 1) continue;
      if (value < lo || value > hi) return `Field ${i + 1} must be between ${lo} and ${hi}.`;
    }
  }
  return null;
}

/** The editor's state for a stored cron: a preset when it is one, else the raw expression. */
export function scheduleFromCron(cron: string | undefined | null, timezone: string): ScheduleDraft {
  const base: ScheduleDraft = { repeats: 'daily', hour: 2, minute: 0, days: [1], cron: cron?.trim() || '0 2 * * *', timezone };
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-7](,[0-7])*)$/.exec(cron?.trim() ?? '');
  if (!m) return cron?.trim() ? { ...base, repeats: 'cron' } : base;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  if (minute > 59 || hour > 23) return { ...base, repeats: 'cron' };
  if (m[3] === '*') return { ...base, hour, minute, repeats: 'daily' };
  if (m[3] === '1-5') return { ...base, hour, minute, repeats: 'weekdays' };
  return { ...base, hour, minute, repeats: 'weekly', days: m[3]!.split(',').map((d) => Number(d) % 7) };
}

/** "Daily 02:00", "Weekdays 07:30", "Fridays 16:00", "Mon, Wed 09:00", or the cron itself. */
export function scheduleSummary(cron: string | undefined | null): string {
  if (!cron?.trim()) return 'Schedule';
  const s = scheduleFromCron(cron, '');
  const time = `${pad(s.hour)}:${pad(s.minute)}`;
  switch (s.repeats) {
    case 'daily':
      return `Daily ${time}`;
    case 'weekdays':
      return `Weekdays ${time}`;
    case 'weekly':
      return s.days.length === 1 ? `${DAY_PLURAL[s.days[0]!]} ${time}` : `${s.days.map((d) => DAY_SHORT[d]).join(', ')} ${time}`;
    case 'cron':
      return cron.trim();
  }
}

/** IANA zones the runtime knows (Hermes ships `Intl.supportedValuesOf`), the device's own first. */
export function timeZones(): string[] {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const all = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : ['UTC'];
  return [...new Set([own, 'UTC', ...all])].filter(Boolean);
}

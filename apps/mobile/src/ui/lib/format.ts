// Intl wrappers (MD-29): durations and counts for the kit. Spoken forms feed accessibility labels.

/** A running duration as m:ss or h:mm:ss (tabular, mono). Negative or invalid input reads 0:00. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** The same duration for a screen reader: "4 minutes 12 seconds". */
export function spokenElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const parts: string[] = [];
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const unit = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (h) parts.push(unit(h, 'hour'));
  if (m) parts.push(unit(m, 'minute'));
  if (s || parts.length === 0) parts.push(unit(s, 'second'));
  return parts.join(' ');
}

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** A count with an optional cap: 120 with max 99 → "99+". */
export function formatCount(value: number, max?: number): string {
  if (max !== undefined && value > max) return `${integer.format(max)}+`;
  return integer.format(value);
}

const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** A byte size: "812 B", "2.1 KB", "4.2 MB", "1.3 GB" (1024 steps, like the desktop size meters). */
export function formatBytes(bytes: number): string {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? integer.format(value) : oneDecimal.format(value)} ${units[unit]}`;
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** Compact relative time for rows (mono): "now", "3m", "1h", "2d", then "Sep 23". Invalid input → "". */
export function formatRelativeShort(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return shortDate.format(t);
}

/** The same for a screen reader: "just now", "3 minutes ago", "on Sep 23". */
export function spokenRelative(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  const unit = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return unit(Math.floor(s / 60), 'minute');
  if (s < 86_400) return unit(Math.floor(s / 3600), 'hour');
  if (s < 7 * 86_400) return unit(Math.floor(s / 86_400), 'day');
  return `on ${shortDate.format(t)}`;
}

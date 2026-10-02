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

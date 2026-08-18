// ────────────────────────────────────────────────────────────────
// Value formatting shared by every surface.
//
// A status glyph, a relative time and a byte count must read the same in the
// binary output, the TUI and the docs, so they are computed once here rather
// than in each renderer.
// ────────────────────────────────────────────────────────────────

/**
 * Semantic status buckets.
 *
 * Colour alone must never carry meaning — roughly 1 in 12 men cannot
 * distinguish the red/green pair, and a piped log has no colour at all — so
 * every status also gets a glyph.
 */
export type StatusTone = 'running' | 'success' | 'failure' | 'warning' | 'idle' | 'neutral';

const STATUS_TONES: Record<string, StatusTone> = {
  running: 'running',
  starting: 'running',
  streaming: 'running',
  active: 'running',
  creating: 'running',
  completed: 'success',
  complete: 'success',
  succeeded: 'success',
  ok: 'success',
  passed: 'success',
  resolved: 'success',
  failed: 'failure',
  error: 'failure',
  cancelled: 'failure',
  canceled: 'failure',
  revoked: 'failure',
  paused: 'warning',
  sleeping: 'warning',
  awaiting_input: 'warning',
  pending: 'idle',
  queued: 'idle',
  created: 'idle',
  skipped: 'neutral',
  archived: 'neutral',
};

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return 'neutral';
  return STATUS_TONES[status.toLowerCase()] ?? 'neutral';
}

const UNICODE_GLYPHS: Record<StatusTone, string> = {
  running: '⟳',
  success: '✓',
  failure: '✗',
  warning: '⏸',
  idle: '○',
  neutral: '·',
};

const ASCII_GLYPHS: Record<StatusTone, string> = {
  running: '>',
  success: '+',
  failure: 'x',
  warning: '!',
  idle: 'o',
  neutral: '-',
};

export function statusGlyph(status: string | null | undefined, unicode = true): string {
  return (unicode ? UNICODE_GLYPHS : ASCII_GLYPHS)[statusTone(status)];
}

/** Wire timestamps are ISO strings; subtracting them raw yields NaN. */
export function toEpoch(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Convenience for sort comparators: unparseable values sort last. */
export function epochOr(value: string | number | null | undefined, fallback = 0): number {
  return toEpoch(value) ?? fallback;
}

export function formatRelative(value: string | number | null | undefined, now = Date.now()): string {
  const epoch = toEpoch(value);
  if (epoch === null) return '—';

  const delta = now - epoch;
  const future = delta < 0;
  const abs = Math.abs(delta);

  const units: Array<[number, string]> = [
    [1000, 's'],
    [60_000, 'm'],
    [3_600_000, 'h'],
    [86_400_000, 'd'],
  ];

  if (abs < 5_000) return 'just now';
  let text = '';
  if (abs < 60_000) text = `${Math.floor(abs / units[0]![0])}s`;
  else if (abs < 3_600_000) text = `${Math.floor(abs / units[1]![0])}m`;
  else if (abs < 86_400_000) text = `${Math.floor(abs / units[2]![0])}h`;
  else if (abs < 30 * 86_400_000) text = `${Math.floor(abs / units[3]![0])}d`;
  else return new Date(epoch).toISOString().slice(0, 10);

  return future ? `in ${text}` : `${text} ago`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)}${units[unit]}`;
}

/** Shortens a UUID to its first segment; leaves anything else alone. */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 8 && id.includes('-') ? id.slice(0, 8) : id;
}

/**
 * Reads a dotted path out of a row.
 *
 * Column keys are declared as paths (`definition.name`) so a table can render
 * a nested payload without every command having to flatten its own rows.
 */
export function readPath(row: unknown, dottedKey: string): unknown {
  let node: unknown = row;
  for (const key of dottedKey.split('.')) {
    if (node === null || node === undefined || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** One cell's display text, honouring the column's declared format. */
export function formatCell(
  value: unknown,
  format: string | undefined,
  options: { unicode?: boolean; now?: number } = {},
): string {
  if (value === null || value === undefined) return '—';

  switch (format) {
    case 'id':
      return shortId(String(value));
    case 'date':
      return toEpoch(value as string) ? new Date(toEpoch(value as string)!).toISOString() : '—';
    case 'relative':
      return formatRelative(value as string, options.now);
    case 'duration':
      return formatDuration(typeof value === 'number' ? value : Number(value));
    case 'bytes':
      return formatBytes(typeof value === 'number' ? value : Number(value));
    case 'boolean':
      return value ? (options.unicode === false ? 'yes' : '✓') : (options.unicode === false ? 'no' : '·');
    case 'list':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'status':
      return `${statusGlyph(String(value), options.unicode !== false)} ${String(value)}`;
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value);
    default:
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
  }
}

/** Collapses whitespace so a multi-line field cannot break a table row. */
export function singleLine(text: string, max = 200): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/**
 * Fits text to exactly `width` cells, truncating as well as padding.
 *
 * `padEnd` alone only ever grows a string, so an over-long value silently
 * runs into whatever column comes after it.
 */
export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width);
}

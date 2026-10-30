// Pure Textarea logic (03 MP-18): row-based height bounds and the size meter.
import { formatBytes, formatCount } from '../../lib/format';
import type { TextareaMeter } from './Textarea.types';

/** min / max heights for the text box, from the role's line height and the vertical padding. */
export function rowBounds(lineHeight: number, padding: number, minRows = 3, maxRows = 8): { minHeight: number; maxHeight: number } {
  const lo = Math.max(1, minRows);
  const hi = Math.max(lo, maxRows);
  return { minHeight: lo * lineHeight + padding, maxHeight: hi * lineHeight + padding };
}

export type MeterTone = 'fg-3' | 'warn' | 'err';

export function meterText({ used, max, unit }: TextareaMeter): string {
  return unit === 'bytes' ? `${formatBytes(used)} of ${formatBytes(max)}` : `${formatCount(used)} of ${formatCount(max)} characters`;
}

/** warn from 90 %, err past the limit (a size meter names a state, MD-25). */
export function meterTone({ used, max }: TextareaMeter): MeterTone {
  if (max <= 0) return 'fg-3';
  if (used > max) return 'err';
  return used / max >= 0.9 ? 'warn' : 'fg-3';
}

/** UTF-8 byte length of a string (the server's size limits count bytes). */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

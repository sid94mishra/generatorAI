// ────────────────────────────────────────────────────────────────
// Text → USB HID keyboard usages (US layout) for the iOS simulator, whose
// only text path is key events. Pure.
// ────────────────────────────────────────────────────────────────

import type { DeviceKey } from '@generatorai/shared';

export const HID_SHIFT = 0xe1;

export interface HidStroke {
  usage: number;
  shift: boolean;
}

const UNSHIFTED: Record<string, number> = {
  '1': 0x1e, '2': 0x1f, '3': 0x20, '4': 0x21, '5': 0x22, '6': 0x23, '7': 0x24, '8': 0x25, '9': 0x26, '0': 0x27,
  '\n': 0x28, '\t': 0x2b, ' ': 0x2c, '-': 0x2d, '=': 0x2e, '[': 0x2f, ']': 0x30, '\\': 0x31, ';': 0x33, "'": 0x34,
  '`': 0x35, ',': 0x36, '.': 0x37, '/': 0x38,
};

const SHIFTED: Record<string, number> = {
  '!': 0x1e, '@': 0x1f, '#': 0x20, '$': 0x21, '%': 0x22, '^': 0x23, '&': 0x24, '*': 0x25, '(': 0x26, ')': 0x27,
  _: 0x2d, '+': 0x2e, '{': 0x2f, '}': 0x30, '|': 0x31, ':': 0x33, '"': 0x34, '~': 0x35, '<': 0x36, '>': 0x37, '?': 0x38,
};

export const HID_NAMED_KEYS: Record<DeviceKey, number> = {
  enter: 0x28,
  escape: 0x29,
  delete: 0x2a,
  tab: 0x2b,
  right: 0x4f,
  left: 0x50,
  down: 0x51,
  up: 0x52,
};

/** One stroke per character; null for a character the US layout cannot type. */
export function hidStrokeFor(ch: string): HidStroke | null {
  if (ch >= 'a' && ch <= 'z') return { usage: 0x04 + ch.charCodeAt(0) - 97, shift: false };
  if (ch >= 'A' && ch <= 'Z') return { usage: 0x04 + ch.charCodeAt(0) - 65, shift: true };
  if (ch === '\r') return null;
  const plain = UNSHIFTED[ch];
  if (plain !== undefined) return { usage: plain, shift: false };
  const shifted = SHIFTED[ch];
  if (shifted !== undefined) return { usage: shifted, shift: true };
  return null;
}

/** Strokes for a string, plus the characters it had to skip. */
export function hidStrokesFor(text: string): { strokes: HidStroke[]; skipped: string[] } {
  const strokes: HidStroke[] = [];
  const skipped: string[] = [];
  for (const ch of text) {
    const stroke = hidStrokeFor(ch);
    if (stroke) strokes.push(stroke);
    else if (ch !== '\r') skipped.push(ch);
  }
  return { strokes, skipped };
}

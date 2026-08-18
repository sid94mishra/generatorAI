// Regression tests for chord resolution.
//
// Each case here was a real bug that made a documented key silently do
// nothing, which in a TUI is indistinguishable from the app being broken.

import { describe, expect, it } from 'vitest';
import { toChord } from '../hooks.js';
import type { Key } from 'ink';

const key = (over: Partial<Key> = {}): Key =>
  ({
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageDown: false, pageUp: false, return: false, escape: false, ctrl: false,
    shift: false, tab: false, backspace: false, delete: false, meta: false,
    ...over,
  }) as Key;

describe('toChord', () => {
  it('reads a bare Escape as `escape`, not `alt+escape`', () => {
    // Ink flags the lone `\x1b` byte as `meta` because Alt+key is encoded the
    // same way. Trusting that makes Esc match no binding anywhere.
    expect(toChord('\u001B', key({ escape: true, meta: true }))).toBe('escape');
  });

  it('still reads a genuine Alt chord as alt+', () => {
    expect(toChord('b', key({ meta: true }))).toBe('alt+b');
  });

  it('reads control chords', () => {
    expect(toChord('b', key({ ctrl: true }))).toBe('ctrl+b');
    expect(toChord('k', key({ ctrl: true }))).toBe('ctrl+k');
  });

  it('names the non-printing keys', () => {
    expect(toChord('', key({ return: true }))).toBe('return');
    expect(toChord('', key({ tab: true }))).toBe('tab');
    expect(toChord('', key({ upArrow: true }))).toBe('up');
    expect(toChord('', key({ pageUp: true }))).toBe('pageup');
    expect(toChord(' ', key())).toBe('space');
  });

  it('passes a plain character through', () => {
    expect(toChord('g', key())).toBe('g');
    expect(toChord('?', key())).toBe('?');
  });
});

import { describe, expect, it } from 'vitest';

import { SHEET_TOP_GAP, detentOffsets, keyboardCappedHeight, renderedOffset } from '../components/ui/sheetMath';

const SCREEN = 874;
const TOP = 62; // Dynamic Island status bar
const TALL = Math.min(SCREEN * 0.92, SCREEN - TOP - SHEET_TOP_GAP);

describe('keyboardCappedHeight', () => {
  it('leaves the sheet alone with no keyboard', () => {
    expect(keyboardCappedHeight(TALL, SCREEN, TOP, 0)).toBe(TALL);
  });

  it('caps a tall sheet so its top stays below the status bar with the keyboard up', () => {
    const keyboard = 336;
    const capped = keyboardCappedHeight(TALL, SCREEN, TOP, keyboard);
    expect(capped).toBe(SCREEN - TOP - SHEET_TOP_GAP - keyboard);
    // Card top = screen - keyboard - capped: never above the status bar gap.
    expect(SCREEN - keyboard - capped).toBeGreaterThanOrEqual(TOP + SHEET_TOP_GAP);
  });

  it('does not grow a short sheet', () => {
    expect(keyboardCappedHeight(240, SCREEN, TOP, 336)).toBe(240);
  });

  it('never goes negative', () => {
    expect(keyboardCappedHeight(TALL, 400, TOP, 500)).toBe(0);
  });
});

describe('renderedOffset', () => {
  const offsets = detentOffsets([0.6, 0.92], SCREEN, TALL);

  it('is the identity when nothing is capped', () => {
    for (const offset of [...offsets, TALL, 120]) {
      expect(renderedOffset(offset, TALL, TALL)).toBe(offset);
    }
  });

  it('keeps closed fully off-screen when capped', () => {
    const capped = keyboardCappedHeight(TALL, SCREEN, TOP, 336);
    expect(renderedOffset(TALL, TALL, capped)).toBe(capped);
  });

  it('pins detents taller than the available space to the top of it', () => {
    const capped = keyboardCappedHeight(TALL, SCREEN, TOP, 336);
    expect(renderedOffset(offsets[1]!, TALL, capped)).toBe(0);
    // Visible height never exceeds what the uncapped detent would show.
    const visible = capped - renderedOffset(offsets[0]!, TALL, capped);
    expect(visible).toBeLessThanOrEqual(TALL - offsets[0]!);
  });

  it('keeps an upward rubber-band visible', () => {
    expect(renderedOffset(-12, TALL, 300)).toBe(-12);
  });
});

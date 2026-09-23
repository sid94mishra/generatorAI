import { describe, expect, it } from 'vitest';

import { androidKeyboardOverlap, keyboardOverlap } from '../components/ui/keyboardMath';

describe('Android edge-to-edge overlap', () => {
  it('includes the system bar RN subtracts from the IME event', () => {
    expect(androidKeyboardOverlap(300, 24, false)).toBe(324);
    expect(androidKeyboardOverlap(300, 0, false)).toBe(300);
  });
  it('does not lift hidden or already resized windows', () => {
    expect(androidKeyboardOverlap(0, 24, false)).toBe(0);
    expect(androidKeyboardOverlap(300, 24, true)).toBe(0);
  });
});

describe('keyboardOverlap', () => {
  it('is the distance from the keyboard top to the window bottom when docked', () => {
    // iPhone 16 Pro: 874pt window, 336pt keyboard.
    expect(keyboardOverlap({ screenY: 538, height: 336 }, 874)).toBe(336);
  });

  it('is 0 when the keyboard frame is below the window (hidden)', () => {
    expect(keyboardOverlap({ screenY: 874, height: 336 }, 874)).toBe(0);
    expect(keyboardOverlap({ screenY: 1210, height: 336 }, 874)).toBe(0);
  });

  it('is 0 for an iPad floating / undocked keyboard', () => {
    // 1194pt window, floating keyboard mid-screen.
    expect(keyboardOverlap({ screenY: 500, height: 260 }, 1194)).toBe(0);
  });

  it('only counts the shortcut bar for a hardware keyboard', () => {
    expect(keyboardOverlap({ screenY: 1139, height: 55 }, 1194)).toBe(55);
  });

  it('measures against a window shorter than the screen (Slide Over)', () => {
    // Keyboard frame extends past the window bottom: still docked.
    expect(keyboardOverlap({ screenY: 700, height: 400 }, 1000)).toBe(300);
  });

  it('never exceeds the window and survives malformed events', () => {
    expect(keyboardOverlap({ screenY: -20, height: 2000 }, 874)).toBe(874);
    expect(keyboardOverlap(undefined, 874)).toBe(0);
    expect(keyboardOverlap({ screenY: Number.NaN, height: 300 }, 874)).toBe(0);
    expect(keyboardOverlap({ screenY: 500, height: 300 }, 0)).toBe(0);
  });
});

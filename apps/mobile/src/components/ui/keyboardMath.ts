// ────────────────────────────────────────────────────────────────
// Keyboard overlap — pure geometry, no React Native import.
//
// `endCoordinates.height` is the keyboard's HEIGHT, not how much of the app
// it covers. Those differ exactly where it matters on iOS:
//   • iPad floating / undocked / split keyboard: the frame sits mid-screen
//     and covers nothing at the bottom edge, yet reports a full height, so
//     a composer "lifted" by it floated far above the keyboard.
//   • iPad Slide Over / Stage Manager windows shorter than the screen.
//   • A hardware keyboard: only the shortcut bar shows (~55pt) — its frame
//     is the truth, a stale show-height is not.
// The overlap is therefore measured from where the keyboard's TOP edge lands
// relative to the bottom of the app window.
// ────────────────────────────────────────────────────────────────

export interface KeyboardFrame {
  /** Keyboard frame's top edge, in screen coordinates. */
  screenY: number;
  /** Keyboard frame's height. */
  height: number;
}

/** A floating keyboard whose bottom sits more than this above the window's bottom is undocked. */
const DOCKED_TOLERANCE = 1;

/** RN Android reports IME height minus the bottom system bar, even edge-to-edge. */
export function androidKeyboardOverlap(height: number, bottomInset: number, resizes: boolean): number {
  if (resizes || !Number.isFinite(height) || height <= 0) return 0;
  return height + (Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0);
}

/**
 * How much of the window's bottom the keyboard covers, in points.
 *
 * `max(0, windowHeight - screenY)` for a keyboard docked at the bottom edge;
 * 0 for one that floats (its bottom edge is above the window's), because
 * nothing anchored to the bottom is covered by it.
 */
export function keyboardOverlap(frame: KeyboardFrame | null | undefined, windowHeight: number): number {
  'worklet';
  if (!frame || !Number.isFinite(frame.screenY) || !(windowHeight > 0)) return 0;
  const height = Number.isFinite(frame.height) ? Math.max(0, frame.height) : 0;
  const bottom = frame.screenY + height;
  // Undocked: the frame ends above the bottom of the window.
  if (height > 0 && bottom < windowHeight - DOCKED_TOLERANCE) return 0;
  return Math.max(0, Math.min(windowHeight, windowHeight - frame.screenY));
}

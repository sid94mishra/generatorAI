// ────────────────────────────────────────────────────────────────
// Pager geometry — pure functions, no React Native.
//
// Coordinate system: `offset` is the track's translateX, so page `i` rests
// at `-i * width` and dragging LEFT (toward the next page) makes the offset
// more negative. Every function is `'worklet'`-safe because the settle
// decision runs on the UI thread at the end of the pan.
// ────────────────────────────────────────────────────────────────

/**
 * Width of the strip along the left edge the pager leaves alone.
 *
 * The iOS back-swipe and Android's predictive back both begin in this strip;
 * a pager that claims it makes every pushed screen impossible to leave with
 * a gesture.
 */
export const EDGE_GUTTER = 24;
/** A throw faster than this (px/s) turns the page regardless of distance. */
export const FLICK_VELOCITY = 500;
/** Fraction of a page the finger must cross before a slow release turns it. */
export const TURN_FRACTION = 0.5;
/** Resistance applied when dragging past the first or last page. */
export const OVERSCROLL_RESISTANCE = 0.3;

/** Whether a touch began inside the reserved edge strip. */
export function isEdgeTouch(x: number, gutter: number = EDGE_GUTTER, width?: number): boolean {
  'worklet';
  return x < gutter || (width !== undefined && x > width - gutter);
}

/** Resting translateX for a page. */
export function pageOffset(index: number, width: number): number {
  'worklet';
  // `0 - x` rather than `-x` so page 0 rests at +0, not -0, which is what
  // equality checks and shared-value comparisons expect.
  return 0 - index * width;
}

/** Keep an index inside `[0, count - 1]`. */
export function clampIndex(index: number, count: number): number {
  'worklet';
  if (count <= 0) return 0;
  return Math.min(Math.max(Math.round(index), 0), count - 1);
}

/**
 * Apply end-of-track resistance to a raw drag offset.
 *
 * Past either end the track keeps following the finger at a fraction of its
 * speed, which is what tells the user "there is nothing further" without the
 * dead stop that reads as the gesture having failed.
 */
export function clampOffset(
  offset: number,
  width: number,
  count: number,
  resistance: number = OVERSCROLL_RESISTANCE,
): number {
  'worklet';
  const min = pageOffset(Math.max(count - 1, 0), width);
  if (offset > 0) return offset * resistance;
  if (offset < min) return min + (offset - min) * resistance;
  return offset;
}

/** Continuous page position, 0..count-1, for indicators. */
export function pageProgress(offset: number, width: number, count: number): number {
  'worklet';
  if (width <= 0 || count <= 0) return 0;
  const raw = -offset / width;
  return Math.min(Math.max(raw, 0), count - 1);
}

export interface SettleInput {
  /** translateX at release. */
  offset: number;
  /** Release velocity in px/s; negative means the finger moved left. */
  velocity: number;
  width: number;
  count: number;
  /** The page the gesture started on. */
  from: number;
}

/**
 * Which page a release lands on.
 *
 * At most one page per gesture, as `UIPageViewController` does — a long fast
 * drag across three panes is almost always an accident, and landing three
 * pages away leaves the user with no idea where they are. A flick past
 * `FLICK_VELOCITY` turns the page in its direction; a slow release turns it
 * only once the finger has crossed `TURN_FRACTION` of the width.
 */
export function settlePage(input: SettleInput): number {
  'worklet';
  const { offset, velocity, width, count, from } = input;
  if (width <= 0 || count <= 0) return 0;

  const start = clampIndex(from, count);
  // Positive when the finger moved left (toward the next page).
  const travelled = (pageOffset(start, width) - offset) / width;

  let target = start;
  if (velocity < -FLICK_VELOCITY) target = start + 1;
  else if (velocity > FLICK_VELOCITY) target = start - 1;
  else if (travelled >= TURN_FRACTION) target = start + 1;
  else if (travelled <= -TURN_FRACTION) target = start - 1;

  // A flick against the drag direction (the finger moved right, then flicked
  // left) must not turn the page the wrong way past where it started.
  if (target > start && travelled < 0) target = start;
  if (target < start && travelled > 0) target = start;

  return clampIndex(target, count);
}

/**
 * Which pages should be mounted for `active`, given how many neighbours to
 * pre-mount on each side. Returned ascending.
 */
export function mountedPages(active: number, count: number, preload: number): number[] {
  const out: number[] = [];
  const lo = Math.max(0, active - preload);
  const hi = Math.min(count - 1, active + preload);
  for (let i = lo; i <= hi; i += 1) out.push(i);
  return out;
}

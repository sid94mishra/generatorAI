// ────────────────────────────────────────────────────────────────
// Sheet geometry — pure functions, no React Native.
//
// Kept apart from `Sheet.tsx` so the snapping rules can be unit-tested in
// node. Everything here is also `'worklet'`-safe: no closures over module
// state, no allocation beyond a couple of locals, because `snapDetent` runs
// on the UI thread at the end of every drag.
//
// Coordinate system: `offset` is the sheet's translateY from FULLY OPEN, so
//   0            → resting at the tallest detent
//   sheetHeight  → fully off-screen (closed)
// A detent's offset therefore SHRINKS as the detent gets taller.
// ────────────────────────────────────────────────────────────────

/** Past this fraction of the sheet's height below the lowest detent, dismiss. */
export const DISMISS_FRACTION = 0.35;
/** Or past this downward velocity (px/s), regardless of distance. */
export const DISMISS_VELOCITY = 900;
/** A throw faster than this only considers detents in its own direction. */
export const FLICK_VELOCITY = 350;
/** Seconds of travel a throw is projected over before choosing a detent. */
export const PROJECTION_SECONDS = 0.08;
/** How much of an upward over-drag past the tallest detent is shown. */
export const RUBBER_BAND = 0.25;

export type SnapResult = { kind: 'dismiss' } | { kind: 'snap'; index: number };

export interface SnapInput {
  /** Current translateY, see the coordinate note above. */
  offset: number;
  /** Release velocity in px/s; positive is downward (toward closed). */
  velocity: number;
  /** translateY of each detent, index-aligned with the caller's detents. */
  offsets: readonly number[];
  /** Full height of the sheet card — the closed offset. */
  sheetHeight: number;
  /** A persistent sheet snaps back instead of dismissing. */
  persistent?: boolean;
}

/** translateY for each detent fraction. Index-aligned with `detents`. */
export function detentOffsets(detents: readonly number[], screenHeight: number, sheetHeight: number): number[] {
  'worklet';
  const out: number[] = [];
  for (let i = 0; i < detents.length; i += 1) {
    out.push(Math.max(0, sheetHeight - screenHeight * detents[i]!));
  }
  return out;
}

/** Resist dragging above the tallest detent instead of detaching from the top. */
export function rubberBand(offset: number, coefficient: number = RUBBER_BAND): number {
  'worklet';
  return offset < 0 ? offset * coefficient : offset;
}

/**
 * Where a release lands.
 *
 * Velocity is consulted before distance so a quick flick closes even when the
 * finger barely moved — that is what makes a sheet feel like a sheet rather
 * than a panel that has to be dragged all the way down. A slower throw is
 * projected forward a little and then, if it is still clearly directional,
 * only detents in that direction are candidates: flicking up from the lowest
 * detent must reach the next one even when "nearest" would snap it back.
 */
export function snapDetent(input: SnapInput): SnapResult {
  'worklet';
  const { offset, velocity, offsets, sheetHeight } = input;
  const persistent = input.persistent === true;

  if (offsets.length === 0) return { kind: 'snap', index: 0 };

  // The lowest detent has the LARGEST offset.
  let lowest = offsets[0]!;
  for (let i = 1; i < offsets.length; i += 1) {
    if (offsets[i]! > lowest) lowest = offsets[i]!;
  }

  const projected = offset + velocity * PROJECTION_SECONDS;

  if (!persistent) {
    const flungDown = velocity > DISMISS_VELOCITY;
    const draggedPast = velocity >= 0 && projected > lowest + sheetHeight * DISMISS_FRACTION;
    if (flungDown || draggedPast) return { kind: 'dismiss' };
  }

  const directional = Math.abs(velocity) > FLICK_VELOCITY;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < offsets.length; i += 1) {
    const target = offsets[i]!;
    if (directional) {
      // Moving down (velocity > 0) means the offset is growing: only detents
      // at or below the current position qualify, and vice versa. A small
      // tolerance keeps the detent we are resting on from being excluded by
      // a sub-pixel settle error.
      if (velocity > 0 && target < offset - 1) continue;
      if (velocity < 0 && target > offset + 1) continue;
    }
    const distance = Math.abs(projected - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  // A directional throw with no candidate in that direction (already at the
  // end of the range) falls back to the nearest detent overall.
  if (best < 0) {
    for (let i = 0; i < offsets.length; i += 1) {
      const distance = Math.abs(projected - offsets[i]!);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
  }

  return { kind: 'snap', index: best };
}

/** The detent index whose offset is closest to `offset`. */
export function nearestDetent(offset: number, offsets: readonly number[]): number {
  'worklet';
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < offsets.length; i += 1) {
    const distance = Math.abs(offsets[i]! - offset);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Gap kept between the sheet's top edge and the status bar. */
export const SHEET_TOP_GAP = 8;

/**
 * The sheet card's height while the keyboard is up.
 *
 * The sheet is lifted by the keyboard (padding under it), so a card of fixed
 * height `sheetHeight` pushed its title and grabber off the top of the
 * screen once `sheetHeight + keyboard` exceeded the space below the status
 * bar. The card is capped to what is left instead; its scroller absorbs the
 * difference.
 */
export function keyboardCappedHeight(
  sheetHeight: number,
  screenHeight: number,
  statusBarTop: number,
  keyboard: number,
): number {
  'worklet';
  const available = screenHeight - statusBarTop - SHEET_TOP_GAP - Math.max(0, keyboard);
  return Math.max(0, Math.min(sheetHeight, available));
}

/**
 * translateY to render for a card capped to `renderedHeight`.
 *
 * Detent and drag math stay in the uncapped coordinate system (offset 0 =
 * tallest detent, `sheetHeight` = closed), so snapping is unaffected by the
 * keyboard. Rendering subtracts the height the cap removed: a detent that
 * would show more than fits sits at the top of the available space, closed
 * still means fully off-screen, and an upward rubber-band stays visible.
 */
export function renderedOffset(offset: number, sheetHeight: number, renderedHeight: number): number {
  'worklet';
  if (offset < 0) return offset;
  const trimmed = Math.max(0, sheetHeight - renderedHeight);
  return Math.max(0, offset - trimmed);
}

/** Exclude the translated-offscreen region from the body's layout viewport. */
export function sheetBottomPadding(offset: number, bottomInset: number): number {
  'worklet';
  return Math.max(0, offset) + bottomInset;
}

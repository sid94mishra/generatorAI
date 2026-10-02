// Pure SwipeRow logic (03 ML-15; MD-52): action widths, the full-swipe arming distance, and the action performed.
import type { SwipeAction, SwipeRowProps } from './SwipeRow.types';

/** Width of a side's revealed actions: per-action width (geometry().controls.swipeAction) × count. */
export function revealWidth(count: number, perAction: number): number {
  return Math.max(0, count) * perAction;
}

/** A full swipe arms past the revealed actions plus 60, or 60 % of the row, whichever is further. */
export function fullSwipeDistance(rowWidth: number, reveal: number): number {
  return Math.max(reveal + 60, rowWidth * 0.6);
}

/** The action a full swipe on a side performs: that side's last action, if full swipe is on for it. */
export function fullSwipeAction(props: Pick<SwipeRowProps, 'leading' | 'trailing' | 'fullSwipe'>, side: 'leading' | 'trailing'): SwipeAction | undefined {
  const mode = props.fullSwipe ?? (props.trailing?.length ? 'trailing' : false);
  if (mode !== side) return undefined;
  const actions = side === 'leading' ? props.leading : props.trailing;
  return actions?.[actions.length - 1];
}

/**
 * The leading actions drawn as a swipe on a platform (MD-52): iOS tiles; Android has trailing pills only, so its
 * leading actions (Pin / Mark unread) live in the row menu and the accessibility actions, not under a gesture.
 */
export function swipeableLeading(leading: ReadonlyArray<SwipeAction> | undefined, platform: 'ios' | 'android'): ReadonlyArray<SwipeAction> {
  return platform === 'android' ? [] : (leading ?? []);
}

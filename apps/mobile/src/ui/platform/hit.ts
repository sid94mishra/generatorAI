// Hit areas come from the Pressable frame (MD-91; mobile 02 §3.4): `hitFrameFor` returns the padding that grows a
// drawn element to the platform minimum (44 pt iOS / 48 dp Android). `hitSlopFor` is a last resort: every use is
// listed in apps/mobile/e2e/a11y-allow.json, because the accessibility snapshot cannot see hitSlop.
import { geometry } from './geometry';

export interface HitFrame {
  paddingHorizontal: number;
  paddingVertical: number;
}

/** Pure form: the frame padding for a drawn size against a target. */
export function hitFrame(target: number, width: number, height: number): HitFrame {
  return {
    paddingHorizontal: Math.max(0, (target - width) / 2),
    paddingVertical: Math.max(0, (target - height) / 2),
  };
}

export function hitFrameFor(width: number, height: number): HitFrame {
  return hitFrame(geometry().minHitTarget, width, height);
}

export function hitSlopFor(width: number, height: number): { top: number; bottom: number; left: number; right: number } {
  const { paddingHorizontal: x, paddingVertical: y } = hitFrameFor(width, height);
  return { top: y, bottom: y, left: x, right: x };
}

/** Minimum gap between two adjacent drawn controls so their frames touch without overlapping (02 §3.4). */
export function adjacentGapFor(drawn: number): number {
  return Math.max(0, geometry().minHitTarget - drawn);
}

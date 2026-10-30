// Pure SegmentedControl logic (03 MP-23; MD-47): native segments, the drawn JS path, or a Select.
import type { Segment } from './SegmentedControl.types';

export type SegmentedPresentation = 'native' | 'js' | 'select';

/** Large-text threshold: iOS accessibilityMedium (≈ 1.6) and above; Android font scale ≥ 1.3 (MD-47). */
export const LARGE_TEXT_SCALE = { ios: 1.6, android: 1.3 } as const;

/** Native segments draw text only: a count, glyph, lock or disabled segment needs the JS path. */
export function needsDrawnSegments(segments: ReadonlyArray<Segment<string>>): boolean {
  return segments.some((s) => s.count !== undefined || s.icon !== undefined || s.locked || s.disabled);
}

export function chooseSegmentedPresentation({
  count,
  fontScale,
  available,
  intrinsic,
  drawn,
  platform,
}: {
  count: number;
  fontScale: number;
  /** Measured row width; 0 before the first layout (assume it fits). */
  available: number;
  intrinsic: number;
  drawn: boolean;
  platform: 'ios' | 'android';
}): SegmentedPresentation {
  if (count > 4) return 'select';
  if (fontScale >= LARGE_TEXT_SCALE[platform]) return 'select';
  if (available > 0 && intrinsic > available) return 'select';
  return drawn ? 'js' : 'native';
}

const CHAR = 7.5;
const PAD = 24;

/** A conservative width estimate for all segments at a font scale (13 / 14 pt labels). */
export function estimateSegmentsWidth(segments: ReadonlyArray<Segment<string>>, fontScale: number): number {
  const scale = Math.max(1, fontScale);
  return segments.reduce((sum, s) => {
    const text = s.label.length * CHAR + (s.count === undefined ? 0 : String(s.count).length * CHAR + 6);
    const glyph = s.icon || s.locked ? 20 : 0;
    return sum + Math.ceil((text + glyph) * scale) + PAD;
  }, 4);
}

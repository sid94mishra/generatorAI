// The presentation decision as a hook: measures the row once laid out and re-decides on font-scale or width
// changes, without remounting the parent (03 MP-23).
import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { nativePlatform } from '../../platform/geometry';
import { useFontScale, useFontScaleOverride } from '../../platform/fontScale';
import type { Segment } from './SegmentedControl.types';
import { chooseSegmentedPresentation, estimateSegmentsWidth, needsDrawnSegments, type SegmentedPresentation } from './segmentedModel';

export function useSegmentedPresentation(segments: ReadonlyArray<Segment<string>>): {
  presentation: SegmentedPresentation;
  width: number;
  onLayout: (e: LayoutChangeEvent) => void;
} {
  const osScale = useFontScale();
  const fontScale = useFontScaleOverride() ?? osScale;
  const [width, setWidth] = useState(0);
  const presentation = chooseSegmentedPresentation({
    count: segments.length,
    fontScale,
    available: width,
    intrinsic: estimateSegmentsWidth(segments, fontScale),
    drawn: needsDrawnSegments(segments),
    platform: nativePlatform,
  });
  return { presentation, width, onLayout: (e) => setWidth(Math.round(e.nativeEvent.layout.width)) };
}

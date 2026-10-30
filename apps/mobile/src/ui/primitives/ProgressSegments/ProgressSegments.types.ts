// MP-15 ProgressSegments contract (03 MP-15; MD-67).
import type { StatusState } from '@generatorai/shared';

export interface ProgressSegmentsProps {
  segments: ReadonlyArray<{ state: StatusState; label: string }>;
  /** sm 4 (in-app, default), md 6 (run header), lg 8 (Live Activity previews). */
  size?: 'sm' | 'md' | 'lg';
  /** Trailing mono "2/6" (done / total). */
  showFraction?: boolean;
  /** Index of the current stage drawn as a 24 tracker circle with its glyph (Android Live Update style). */
  tracker?: number;
  testID?: string;
}

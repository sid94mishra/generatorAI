// MP-08 StatusDot contract (03 MP-08; MD-25: never alone — a word beside it or a label).
import type { HealthTone, StatusState } from '@generatorai/shared';

export interface StatusDotProps {
  state?: StatusState;
  /** Connection / runtime health (packages/shared HEALTH). */
  health?: HealthTone;
  /** md 8 (default), sm 6 (connection footers). */
  size?: 'sm' | 'md';
  /** 2px ground ring (dot over a glyph or avatar). */
  ring?: boolean;
  /** Transparent with a ring (offline server). */
  hollow?: boolean;
  /** Required when no visible word sits next to the dot. */
  label?: string;
  testID?: string;
}

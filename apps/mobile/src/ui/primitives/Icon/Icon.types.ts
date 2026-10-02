// The Icon contract (MP-02; mobile 02 §5.3). One prop contract for Icon.ios.tsx (SF Symbols),
// Icon.android.tsx (Material Symbols) and Icon.tsx (lucide: Jest, web preview).
import type { MobileIconConcept } from '@generatorai/design-tokens';

export type IconSize = 12 | 14 | 16 | 18 | 20 | 22 | 24;
export type IconTone = 'fg' | 'fg-2' | 'fg-3' | 'accent' | 'on-accent' | 'run' | 'ok' | 'warn' | 'err' | 'surface';

export interface IconProps {
  concept: MobileIconConcept;
  /** Default: the platform's row icon (20 iOS / 24 Android, GEOMETRY.<os>.icon.row). */
  size?: IconSize;
  /** Default 'fg-2'. Glyph colour only ever comes from a tone. */
  tone?: IconTone;
  /** Selected / active state: sfSymbolFill on iOS, the generated filled glyph on Android. */
  filled?: boolean;
  /** 1000 ms linear rotation (status-running, loader); static under reduced motion. */
  spinning?: boolean;
  /** Absent → decorative (hidden from assistive tech). */
  accessibilityLabel?: string;
  testID?: string;
}

export const ICON_TONES: readonly IconTone[] = ['fg', 'fg-2', 'fg-3', 'accent', 'on-accent', 'run', 'ok', 'warn', 'err', 'surface'];

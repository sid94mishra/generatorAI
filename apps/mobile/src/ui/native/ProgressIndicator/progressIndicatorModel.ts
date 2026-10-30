// The one prop mapping both native files use (03 §1.8: tested without a native host).
import type { ProgressIndicatorProps } from './ProgressIndicator.types';

export interface ProgressIndicatorNativeProps {
  /** iOS controlSize. */
  controlSize: 'regular' | 'large';
  /** Android indicator size, dp. */
  dp: 48 | 64;
  contained: boolean;
  /** fg-2 literal from useThemeColors(). */
  color: string;
  /** Android seedColor: the accent unless the accent is ink (where it equals fg). */
  seedColor: string | undefined;
}

export function toProgressIndicatorNativeProps(
  { size = 'md', contained = false }: ProgressIndicatorProps,
  colors: { fg: string; fg2: string; accent: string },
): ProgressIndicatorNativeProps {
  return {
    controlSize: size === 'lg' ? 'large' : 'regular',
    dp: size === 'lg' ? 64 : 48,
    contained,
    color: colors.fg2,
    seedColor: colors.accent === colors.fg ? undefined : colors.accent,
  };
}

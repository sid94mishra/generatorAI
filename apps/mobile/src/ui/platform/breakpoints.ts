// Window-size classes (MD-24; 06 §1.3): the only size-class function in the app. Input is the WINDOW
// (iPad and Android resize windows live), never the device idiom. Thresholds come from GEOMETRY.breakpoints.
import { useWindowDimensions } from 'react-native';
import { GEOMETRY } from '@generatorai/design-tokens';

export type SizeClass = 'compact' | 'medium' | 'expanded';

const { medium, expanded } = GEOMETRY.ios.breakpoints;

export function sizeClassFor(windowWidth: number): SizeClass {
  if (windowWidth >= expanded) return 'expanded';
  if (windowWidth >= medium) return 'medium';
  return 'compact';
}

export function useSizeClass(): { sizeClass: SizeClass; width: number; height: number; fontScale: number } {
  const { width, height, fontScale } = useWindowDimensions();
  return { sizeClass: sizeClassFor(width), width, height, fontScale };
}

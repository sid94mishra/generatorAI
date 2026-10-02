// The active platform's geometry (mobile 02 §3, MD-15): every number the kit needs that a class cannot
// carry (icon sizes, control internals, panel caps, type ramps) comes from here, never from a literal.
import { Platform } from 'react-native';
import { GEOMETRY, type NativeGeometry } from '@generatorai/design-tokens';

export type NativePlatform = 'ios' | 'android';

/** 'android' on Android; 'ios' on iOS and everywhere else (Jest default, web preview: iOS values, 02 §9.2). */
export const nativePlatform: NativePlatform = Platform.OS === 'android' ? 'android' : 'ios';

export function geometry(): NativeGeometry {
  return GEOMETRY[nativePlatform];
}

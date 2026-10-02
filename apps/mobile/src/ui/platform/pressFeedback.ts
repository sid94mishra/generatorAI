// Press feedback per platform (mobile 02 §6.2 `press`): iOS scales buttons (rows highlight); Android uses the
// native ripple (colour: useThemeColors().selected) and never scales.
import { nativePlatform, type NativePlatform } from './geometry';

export type PressFeedbackKind = 'scale' | 'highlight' | 'ripple' | 'none';

/** What a requested feedback becomes on a platform. */
export function pressFeedbackFor(platform: NativePlatform, requested: 'scale' | 'highlight' | 'none'): PressFeedbackKind {
  if (requested === 'none') return 'none';
  return platform === 'android' ? 'ripple' : requested;
}

export function pressFeedback(requested: 'scale' | 'highlight' | 'none'): PressFeedbackKind {
  return pressFeedbackFor(nativePlatform, requested);
}

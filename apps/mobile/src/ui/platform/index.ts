// The OS policy layer (MD-15; 03 §1.1). Only src/ui/platform/** (and ui/**/*.ios|android.tsx) may branch on Platform.
export { geometry, nativePlatform, type NativePlatform } from './geometry';
export { adjacentGapFor, hitFrame, hitFrameFor, hitSlopFor, type HitFrame } from './hit';
export { haptic, setHapticsEnabled } from './haptics';
export { resolveMotion, setMotionPreference, useMotion, useReduceMotion, type MotionConfig, type MotionPreference, type ResolvedMotion } from './motion';
export { useReduceTransparency } from './transparency';
export { useGlass } from './glass';
export { sizeClassFor, useSizeClass, type SizeClass } from './breakpoints';
export { FontScaleOverrideContext, effectiveScale, maxScaleFor, useFontScale, useFontScaleOverride } from './fontScale';
export {
  detailOptions,
  fullScreenModalOptions,
  moduleRootOptions,
  paletteOptions,
  sheetOptions,
  type ScreenPresentationOptions,
  type SheetKind,
} from './presentation';
export { useBackHandler } from './back';
export {
  DRAWER_EDGE_HIT_SLOP,
  DRAWER_EDGE_WIDTH,
  PANEL_PAN,
  PANE_CLOSE_BAND,
  edgeSwipeOpensDrawer,
  paneClosesByPan,
  type EdgeContext,
  type GestureScreenRole,
} from './gestures';
export { pressFeedback, type PressFeedbackKind } from './pressFeedback';
export { nouns, type PlatformNouns } from './nouns';
export { setHardwareKeyboardAttached, useHardwareKeyboard } from './keyboard';
export { readSystemAccentSeeds, systemAccentAvailable, type SystemAccentSeeds } from './accent';

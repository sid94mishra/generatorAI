// Route presentation options (06 §3.1, §3.7; MD-21): the one place screen options branch on OS.
// Routes pass them as `options={sheetOptions('picker')}`. Plain data, typed locally so `ui/` never
// imports the router (MD-86).

import { nativePlatform } from './geometry';

/** The subset of native-stack screen options the kit sets. */
export interface ScreenPresentationOptions {
  presentation?: 'card' | 'formSheet' | 'fullScreenModal' | 'modal';
  animation?: 'default' | 'none' | 'fade' | 'slide_from_right';
  gestureEnabled?: boolean;
  fullScreenGestureEnabled?: boolean;
  headerShown?: boolean;
  sheetAllowedDetents?: number[];
  sheetInitialDetentIndex?: number;
  sheetGrabberVisible?: boolean;
  sheetExpandsWhenScrolledToEdge?: boolean;
  sheetLargestUndimmedDetentIndex?: 'none' | number;
  sheetCornerRadius?: number;
}

/**
 * - `picker`: Turn, model / agent pickers, server switcher, execution detail — half then full.
 * - `approval`: every approval surface, run workflow, scope request — 0.6 then full.
 * - `large`: New chat, commit & PR, share — full only (never fitToContents with a text field on Android).
 */
export type SheetKind = 'picker' | 'approval' | 'large';

const DETENTS: Record<SheetKind, number[]> = { picker: [0.5, 1], approval: [0.6, 1], large: [1] };

/** Android's M3 sheet top radius; iOS keeps the system's concentric radius (MD-72). */
const ANDROID_SHEET_RADIUS = 28;

export function sheetOptionsFor(platform: 'ios' | 'android', kind: SheetKind): ScreenPresentationOptions {
  const base: ScreenPresentationOptions = { presentation: 'formSheet', headerShown: false, sheetAllowedDetents: DETENTS[kind] };
  if (platform === 'android') return { ...base, sheetCornerRadius: ANDROID_SHEET_RADIUS };
  return {
    ...base,
    sheetInitialDetentIndex: 0,
    sheetGrabberVisible: true,
    sheetExpandsWhenScrolledToEdge: true,
    sheetLargestUndimmedDetentIndex: 'none',
  };
}

/** Full-screen modal editors and wizards (MD-21): no swipe-to-dismiss; the dirty guard owns Cancel. */
export const fullScreenModalOptions: ScreenPresentationOptions = { presentation: 'fullScreenModal', gestureEnabled: false };

/** The search palette (MD-81). */
export const paletteOptions: ScreenPresentationOptions = { presentation: 'fullScreenModal', animation: 'fade', headerShown: false };

/**
 * Detail pushes: the native interactive pop on iOS; Android uses system Back (MD-19, MD-20) with the platform push
 * transition (`slide_from_right` matches the system's own back preview).
 */
export function detailOptionsFor(platform: 'ios' | 'android'): ScreenPresentationOptions {
  return { gestureEnabled: true, fullScreenGestureEnabled: false, animation: platform === 'android' ? 'slide_from_right' : 'default' };
}
export const detailOptions: ScreenPresentationOptions = detailOptionsFor(nativePlatform);

/** Module roots replaced from the sidebar switch without animation (06 §3.1, MD-87). */
export const moduleRootOptions: ScreenPresentationOptions = { animation: 'none' };

export function sheetOptions(kind: SheetKind): ScreenPresentationOptions {
  return sheetOptionsFor(nativePlatform, kind);
}

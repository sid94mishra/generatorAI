// One contract for the platform's live surface (06 §7.3): the iOS Live Activity (expo-widgets) or the Android Live
// Update (modules/generatorai-live). `LiveSurfacesSync` decides what to show; a driver only draws it.
import type { LiveState } from '@generatorai/client-core';

import type { WidgetPalette } from '../widgetPalette';

export interface LiveSurfaceDriver {
  /** Keys with a surface on screen, reconciled with the OS after a relaunch (MMKV key → platform id). */
  activeKeys(): string[];
  /** Start, or update when the content changed. */
  show(state: LiveState, palette: WidgetPalette): Promise<void>;
  /** End with the final state; the OS removes it at `at` (MD-90). */
  finish(state: LiveState, palette: WidgetPalette, at: Date): Promise<void>;
  /** End at once (stop following, unpair, switched off, displaced). */
  drop(key: string): Promise<void>;
  /** The app went to the background (06 §7.3 "app background"): last chance to write before suspension. */
  background?(): void;
}

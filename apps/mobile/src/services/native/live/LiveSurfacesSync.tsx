// Drives the platform's live surface from the live store (06 §7.3, MD-90): on every store change (attention, stage
// progress, outcomes, sweeps, follows and the Settings › Widgets switches) it plans which items are shown, held,
// finished or dropped, and hands that to the driver — at most one update per second per item
// (`createLiveCoalescer`), finishes and drops at once. Going to the background flushes pending updates, so the last
// content and its `staleDate` reach the OS before the app is suspended. Mounted once inside the AttentionProvider.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { createLiveCoalescer, type LiveTimers } from '@generatorai/client-core';

import { liveStore, readFollowedIn, readLiveSurfacePrefs } from '../../live/liveStore';
import { planLiveSurfaces } from '../../live/liveSurfaceModel';
import { surfaceCandidates } from '../../live/liveSurfaces';
import { currentWidgetPalette, startWidgetPaletteSync, type WidgetPalette } from '../widgetPalette';
import { liveSurfaceDriver } from './index';

const timers: LiveTimers = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const ignore = (): void => undefined;

export function LiveSurfacesSync(): null {
  useEffect(() => {
    const driver = liveSurfaceDriver();
    if (!driver) return;
    let palette: WidgetPalette | null = currentWidgetPalette();
    const active = new Set(driver.activeKeys());

    const show = (key: string): void => {
      const state = liveStore.getState()[key];
      if (!state || !palette || !active.has(key)) return;
      void driver.show(state, palette).catch(ignore);
    };
    const coalescer = createLiveCoalescer(show, timers);

    const evaluate = (): void => {
      palette ??= currentWidgetPalette();
      if (!palette) return;
      const map = liveStore.getState();
      const plan = planLiveSurfaces(active, map, surfaceCandidates(map, readFollowedIn(map), readLiveSurfacePrefs()));
      for (const state of plan.show) {
        active.add(state.key);
        coalescer.push(state.key);
      }
      for (const end of plan.finish) {
        active.delete(end.key);
        void driver.finish(end.state, palette, end.at).catch(ignore);
      }
      for (const key of plan.drop) {
        active.delete(key);
        void driver.drop(key).catch(ignore);
      }
    };

    const unsubscribe = liveStore.subscribe(evaluate);
    const stopPalette = startWidgetPaletteSync((next) => {
      palette = next;
      for (const key of active) coalescer.push(key);
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') return evaluate();
      if (next !== 'background') return;
      coalescer.cancel();
      for (const key of active) show(key);
      driver.background?.();
    });
    evaluate();
    return () => {
      unsubscribe();
      stopPalette();
      appState.remove();
      coalescer.cancel();
    };
  }, []);
  return null;
}

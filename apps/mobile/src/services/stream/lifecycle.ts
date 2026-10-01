import { useEffect } from 'react';
import { AppState } from 'react-native';
import { focusManager, onlineManager, useQueryClient } from '@tanstack/react-query';
import type { AttentionStore } from '@generatorai/client-core';
import type { LifecycleStream } from './lifecycleStream';
import { BACKGROUND_STREAM_GRACE_MS } from '../native/appLifecyclePolicy';
import { useStreamHealth } from './streamHealth';

let manualResume: (() => void) | null = null;
export function resumeApp(): void { manualResume?.(); }

/** One app-wide resume owner. Live surfaces join this routine in M9. */
export function useLifecycle(stream: LifecycleStream | null, attention: AttentionStore | null): void {
  const queries = useQueryClient();
  useEffect(() => {
    let active = AppState.currentState !== 'background';
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { generation += 1; running = false; if (timer) clearTimeout(timer); };
    const resume = (reason: 'foreground' | 'network' | 'manual') => {
      if (!stream || !attention || !active) return;
      if (reason === 'manual') { cancel(); stream.suspend(); }
      if (running) return;
      running = true;
      const current = ++generation;
      if (reason !== 'network') useStreamHealth.getState().setConnection('reconnecting');
      // Transport recovery is independent of TanStack, which must not keep a
      // failed server permanently offline while its socket tries to reconnect.
      const attempt = async (index: number): Promise<void> => {
        try {
          await stream.resume();
          if (current !== generation) return;
          attention.start();
          await attention.refresh();
          if (current !== generation) return;
          onlineManager.setOnline(useStreamHealth.getState().connection !== 'offline');
          void queries.invalidateQueries({ refetchType: 'active' });
          focusManager.setFocused(true);
          running = false;
        } catch {
          if (current !== generation) return;
          const delay = [1000, 2000, 4000, 8000, 15000][index];
          if (delay === undefined) {
            running = false;
            useStreamHealth.getState().setConnection('offline');
            return;
          }
          useStreamHealth.getState().setConnection('reconnecting', index + 1);
          timer = setTimeout(() => { void attempt(index + 1); }, delay);
        }
      };
      void attempt(0);
    };
    focusManager.setFocused(false);
    onlineManager.setOnline(useStreamHealth.getState().connection !== 'offline');
    const unsubscribe = useStreamHealth.subscribe((next, previous) => {
      onlineManager.setOnline(next.connection !== 'offline');
      if (next.connection === 'connected' && previous.connection !== 'connected') resume('network');
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        active = false;
        cancel();
        focusManager.setFocused(false);
        const suspend = () => { attention?.stop(); stream?.suspend(); };
        if (BACKGROUND_STREAM_GRACE_MS) backgroundTimer = setTimeout(suspend, BACKGROUND_STREAM_GRACE_MS);
        else suspend();
      } else if (next === 'active' && !active) {
        active = true;
        if (backgroundTimer) clearTimeout(backgroundTimer);
        resume('foreground');
      }
    });
    const retry = () => resume('manual');
    manualResume = retry;
    if (active) resume('foreground');
    return () => { if (manualResume === retry) manualResume = null; if (backgroundTimer) clearTimeout(backgroundTimer); cancel(); unsubscribe(); appState.remove(); attention?.stop(); stream?.suspend(); };
  }, [stream, attention, queries]);
}

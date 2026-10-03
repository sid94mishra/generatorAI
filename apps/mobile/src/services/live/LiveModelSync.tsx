// Feeds the live-state store (MX-11, 06 §7.3 "update triggers"): every attention change of the active server (the
// global stream's upserts / removes and the resume routine's refetch both land in the attention store), the outcome
// of items the feed dropped (a workflow run's status; chats and automation executions have no single-item outcome
// API, so they end without a final state — MD-182), and a sweep that ends surfaces after their MD-90 window.
// Mounted once inside the AttentionProvider.
import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { liveAwaitingOutcome, type LiveServer } from '@generatorai/client-core';

import { useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthProvider';
import { useAttention } from '../stream/AttentionProvider';
import { liveStore } from './liveStore';
import { runOutcome } from './liveSurfaces';

/** Sweep and outcome retries while the app is active. */
const TICK_MS = 15_000;

export function LiveModelSync(): null {
  const { serverId, servers } = useAuth();
  const attention = useAttention();
  const api = useApi();
  const snapshot = attention.snapshot;
  const stale = attention.stale;
  const name = servers.find((s) => s.serverId === serverId)?.label ?? 'Server';
  const server = useMemo<LiveServer | null>(() => (serverId ? { id: serverId, name } : null), [serverId, name]);

  // A cached (persisted) snapshot is not a live confirmation: only a fresh one may end items.
  useEffect(() => {
    if (!server || !snapshot || stale) return;
    liveStore.dispatch({ type: 'attention', items: [...snapshot.needsYou, ...snapshot.running], server, now: new Date() });
  }, [server, snapshot, stale]);

  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    const resolve = (): void => {
      for (const item of liveAwaitingOutcome(liveStore.getState())) {
        if (item.serverId !== serverId || item.entity !== 'workflow_run' || inFlight.current.has(item.key)) continue;
        inFlight.current.add(item.key);
        void api.runs
          .get(item.entityId)
          .then((run) => {
            const outcome = runOutcome(run.status);
            if (outcome) liveStore.dispatch({ type: 'ended', key: item.key, outcome, now: new Date() });
          })
          .catch(() => undefined)
          .finally(() => inFlight.current.delete(item.key));
      }
    };
    const tick = (): void => {
      liveStore.dispatch({ type: 'sweep', now: new Date() });
      resolve();
    };
    const unsubscribe = liveStore.subscribe(resolve);
    let timer: ReturnType<typeof setInterval> | null = AppState.currentState === 'active' ? setInterval(tick, TICK_MS) : null;
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        tick();
        timer ??= setInterval(tick, TICK_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    tick();
    return () => {
      unsubscribe();
      appState.remove();
      if (timer) clearInterval(timer);
    };
  }, [api, serverId]);

  return null;
}

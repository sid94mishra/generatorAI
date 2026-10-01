// ────────────────────────────────────────────────────────────────
// useGlobalStream — live lifecycle events for the list screens.
//
// The gap this closes: mobile subscribed the `chat` scope and nothing else,
// so a chat created on the desktop, a run that failed, or an automation that
// finished reached the phone only when TanStack's 30 s staleness expired and
// something refetched. The Chats, Runs and Automations tabs were, in effect,
// polled — and the `global` scope the server has published lifecycle events to
// all along had no subscriber on this surface at all.
//
// It costs no extra connection. `MuxStreamProvider` owns one socket; this is a
// second scope on it (`POST .../subs`), which is the entire reason W09-a
// multiplexed in the first place.
//
// Mounted once, app-wide. Deliberately NOT per screen: three list tabs each
// subscribing the same scope would each pay a `POST .../subs` on mount and
// unmount as the user moves between tabs, for one shared server subscription.
//
// The mapping below is intentionally coarse — a lifecycle event invalidates
// the LIST it belongs to, and nothing else. A list view is the only thing that
// goes wrong when one of these is missed; anything finer belongs in the
// scope that owns the entity.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MuxStreamEvent } from '@generatorai/client-core';

import { useMuxStream } from './MuxStreamProvider';
import { useAuth } from '../auth/AuthProvider';
import {
  GLOBAL_SCOPE_FILTER,
  GLOBAL_SCOPE_ID,
  invalidateListKeys,
  isOwnScopeApproval,
  listKeysForEvent,
} from './muxTransport';
import {
  connectionFromDisconnect,
  requiredScopeFromReason,
  useStreamHealth,
} from './streamHealth';

/**
 * One invalidation batch per frame.
 *
 * A workflow finishing emits several lifecycle events in quick succession
 * (`workflow_run.completed` plus its stages' own); refetching the runs list
 * once per event would put the phone through several identical round trips.
 */
const FLUSH_INTERVAL_MS = 16;

export function useGlobalStream(): void {
  const queryClient = useQueryClient();
  const stream = useMuxStream();
  const pendingRef = useRef(new Set<string>());
  const { state, refreshPermissions } = useAuth();
  const deviceIdRef = useRef<string | null>(null);
  deviceIdRef.current = state.status === 'authenticated' ? state.deviceId : null;
  const refreshRef = useRef(refreshPermissions);
  refreshRef.current = refreshPermissions;
  // D0/S7 — a phone paired before `read:activity` existed does not hold it,
  // and the server now rejects THIS scope alone rather than the whole
  // connection. The client drops the scope after the rejection, so the only
  // way it is ever asked for again is this effect re-running: `Retry` on the
  // strip refreshes the token and bumps the generation.
  const retryGeneration = useStreamHealth((s) => s.retryGeneration);

  useEffect(() => {
    // No client means no session (unpaired, backgrounded): the strip must
    // not report an outage for a socket that was never meant to be open.
    if (!stream) useStreamHealth.getState().setConnection('idle');
  }, [stream]);

  useEffect(() => {
    if (!stream) return;
    const health = useStreamHealth.getState();

    const flush = (): void => {
      const keys = pendingRef.current;
      if (keys.size === 0) return;
      const batch = [...keys];
      keys.clear();
      invalidateListKeys(queryClient, batch);
    };
    const timer = setInterval(flush, FLUSH_INTERVAL_MS);

    const unsubscribe = stream.subscribe(
      'global',
      GLOBAL_SCOPE_ID,
      (event: MuxStreamEvent) => {
        for (const key of listKeysForEvent(event.kind)) {
          pendingRef.current.add(JSON.stringify(key));
        }
        if (isOwnScopeApproval(event, deviceIdRef.current)) {
          void refreshRef.current().catch(() => undefined);
        }
      },
      {
        filter: [...GLOBAL_SCOPE_FILTER],
        onConnected: () => health.setConnection('connected'),
        onReconnecting: (attempt) => health.setConnection('reconnecting', attempt),
        onDisconnected: (reason) => {
          const requiredScope = requiredScopeFromReason(reason);
          if (requiredScope) {
            // The socket is fine; only this scope was refused. Say so by name
            // rather than letting the lists go silently stale.
            health.noteRejected({ scope: 'global', id: GLOBAL_SCOPE_ID, requiredScope });
            return;
          }
          const next = connectionFromDisconnect(reason);
          if (next) health.setConnection(next);
        },
      },
    );

    return () => {
      unsubscribe();
      clearInterval(timer);
      // A lifecycle event that arrived in the last partial tick still has to
      // land, or the list the user is about to look at is stale for no reason.
      flush();
    };
    // `retryGeneration` is a deliberate dependency: it is the re-subscribe signal.
  }, [stream, queryClient, retryGeneration]);
}

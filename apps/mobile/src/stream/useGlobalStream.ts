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
import {
  GLOBAL_SCOPE_FILTER,
  GLOBAL_SCOPE_ID,
  invalidateListKeys,
  listKeysForEvent,
} from './muxTransport';

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

  useEffect(() => {
    if (!stream) return;

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
      },
      { filter: [...GLOBAL_SCOPE_FILTER] },
    );

    return () => {
      unsubscribe();
      clearInterval(timer);
      // A lifecycle event that arrived in the last partial tick still has to
      // land, or the list the user is about to look at is stale for no reason.
      flush();
    };
  }, [stream, queryClient]);
}

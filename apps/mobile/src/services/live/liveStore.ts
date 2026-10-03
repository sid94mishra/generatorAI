// The live-state store (MX-11): the client-core reducer behind a tiny external store, plus this device's follow set
// (MD-90: items started or opened here in the last 24 h). One store for every paired server; the sync component
// feeds the active server's attention into it, unpairing forgets a server. The surfaces (Live Activity / Live
// Update / widgets, M9-03…05) subscribe here.
import { useSyncExternalStore } from 'react';
import { liveReducer, type LiveEvent, type LiveMap } from '@generatorai/client-core';
import type { AttentionEntity } from '@generatorai/shared';

import { prefs, PREF_KEYS } from '../storage/prefs';
import { followedLiveKeys, followedPrefKey, followId, parseFollowMap, type LiveSurfacePrefs } from './liveSurfaces';

let map: LiveMap = {};
/** Bumped on every follow change so `useFollowed` re-reads. */
let followVersion = 0;
const listeners = new Set<() => void>();
const emit = (): void => {
  for (const listener of listeners) listener();
};

export const liveStore = {
  getState: (): LiveMap => map,
  dispatch(event: LiveEvent): void {
    const next = liveReducer(map, event);
    if (next === map) return;
    map = next;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useLiveMap(): LiveMap {
  return useSyncExternalStore(liveStore.subscribe, liveStore.getState, liveStore.getState);
}

/** Follow an item on this device (opened or started here). Re-following refreshes the 24-hour window. */
export function followLive(serverId: string, entity: AttentionEntity, entityId: string, now = Date.now()): void {
  const follows = parseFollowMap(prefs.getString(followedPrefKey(serverId)), now);
  follows[followId(entity, entityId)] = now;
  prefs.setString(followedPrefKey(serverId), JSON.stringify(follows));
  followVersion += 1;
  emit();
}

/** "Stop following": the item's surface ends at once. */
export function unfollowLive(serverId: string, entity: AttentionEntity, entityId: string): void {
  const follows = parseFollowMap(prefs.getString(followedPrefKey(serverId)), Date.now());
  delete follows[followId(entity, entityId)];
  prefs.setString(followedPrefKey(serverId), JSON.stringify(follows));
  followVersion += 1;
  emit();
}

export function readFollowed(serverId: string, now = Date.now()): Set<string> {
  return followedLiveKeys(serverId, parseFollowMap(prefs.getString(followedPrefKey(serverId)), now));
}

/** The follow-set version, for memoising `readFollowed` in components. */
export function useFollowVersion(): number {
  return useSyncExternalStore(liveStore.subscribe, () => followVersion, () => followVersion);
}

/** Settings › Widgets & Live Activities: the per-device choices the surfaces honour. */
export function readLiveSurfacePrefs(): LiveSurfacePrefs {
  return { runs: prefs.getBoolean(PREF_KEYS.liveRuns, true), chats: prefs.getBoolean(PREF_KEYS.liveChats, true) };
}

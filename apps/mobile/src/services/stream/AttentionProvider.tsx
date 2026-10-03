import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { createAttentionStore, initialAttentionState, type AttentionStore } from '@generatorai/client-core';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttentionSnapshot } from '@generatorai/shared';
import type { LifecycleStream } from './lifecycleStream';
import { useLifecycle } from './lifecycle';
import { useApi } from '../api/useApi';
import { LiveModelSync } from '../live/LiveModelSync';
import { LiveSurfacesSync } from '../native/live/LiveSurfacesSync';
import { BadgeSync } from '../notifications/BadgeSync';
import { QuickActionItemsSync } from '../native/quickActions';

const Context = createContext<AttentionStore | null>(null);
const initial = initialAttentionState();
const getInitial = () => initial;
const subscribeEmpty = () => () => {};
const refreshEmpty = async () => {};

/** One sequenced feed for every mobile surface sharing this authenticated stream. */
export function AttentionProvider({ client, children }: { client: LifecycleStream | null; children: React.ReactNode }): React.ReactElement {
  const api = useApi();
  const store = useMemo(() => client ? createAttentionStore(api, client) : null, [api, client]);
  useLifecycle(client, store);
  const queries = useQueryClient();
  useEffect(() => store?.subscribe(() => {
    const state = store.getState();
    if (state.snapshot && !state.needsResync) queries.setQueryData(['attention'], state.snapshot);
  }), [store, queries]);
  return (
    <Context.Provider value={store}>
      {children}
      <LiveModelSync />
      <LiveSurfacesSync />
      <BadgeSync />
      <QuickActionItemsSync />
    </Context.Provider>
  );
}

export function useAttention() {
  const store = useContext(Context);
  const state = useSyncExternalStore(store?.subscribe ?? subscribeEmpty, store?.getState ?? getInitial, getInitial);
  const cached = useQuery<AttentionSnapshot>({ queryKey: ['attention'], queryFn: skipToken, meta: { persist: true } });
  return { ...state, snapshot: state.snapshot ?? cached.data ?? null, stale: !state.snapshot || state.needsResync, refresh: store?.refresh ?? refreshEmpty };
}

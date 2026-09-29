import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { createAttentionStore, initialAttentionState, type AttentionStore, type MuxStreamClient } from '@generatorai/client-core';
import { useApi } from '../api/useApi';

const Context = createContext<AttentionStore | null>(null);
const initial = initialAttentionState();
const getInitial = () => initial;
const subscribeEmpty = () => () => {};
const refreshEmpty = async () => {};

/** One sequenced feed for every mobile surface sharing this authenticated stream. */
export function AttentionProvider({ client, children }: { client: MuxStreamClient | null; children: React.ReactNode }): React.ReactElement {
  const api = useApi();
  const store = useMemo(() => client ? createAttentionStore(api, client) : null, [api, client]);
  useEffect(() => {
    store?.start();
    return () => store?.stop();
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useAttention() {
  const store = useContext(Context);
  const state = useSyncExternalStore(store?.subscribe ?? subscribeEmpty, store?.getState ?? getInitial, getInitial);
  return { ...state, refresh: store?.refresh ?? refreshEmpty };
}

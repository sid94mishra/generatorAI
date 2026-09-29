import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useApi } from '../api/useApi';
import { createMobileMuxClient } from './muxTransport';
import { AttentionProvider } from './AttentionProvider';
import { expoStreamFetch } from './expoStreamFetch';
import { createLifecycleStream, type LifecycleStream } from './lifecycleStream';

const MuxStreamContext = createContext<LifecycleStream | null>(null);
export function useMuxStream(): LifecycleStream | null { return useContext(MuxStreamContext); }

/** Stable subscriptions/cursors across foreground transitions; isolated per authenticated server. */
export function MuxStreamProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { fetch, endpoint, state, serverId } = useAuth();
  const api = useApi();
  const authenticated = state.status === 'authenticated';
  const client = useMemo(() => authenticated && endpoint && serverId ? createLifecycleStream(
    () => createMobileMuxClient({ fetch, endpoint, streamFetch: expoStreamFetch }),
    (scope, id, after) => api.replay(scope, id, after, 500),
  ) : null, [authenticated, endpoint, serverId, fetch, api]);
  useEffect(() => () => client?.disposeAll(), [client]);
  return <MuxStreamContext.Provider value={client}><AttentionProvider client={client}>{children}</AttentionProvider></MuxStreamContext.Provider>;
}

// ────────────────────────────────────────────────────────────────
// MuxStreamProvider — owns the app's ONE shared stream connection.
//
// Mounted once, above every screen, so a chat screen opening and the app-wide
// `global` subscription share a socket instead of opening one each. The
// client is rebuilt only when the auth session changes; a screen mounting or
// unmounting adds and removes a SUBSCRIPTION, which is a `POST .../subs` on
// the existing connection rather than a new one.
//
// Backgrounding tears the connection down and foregrounding rebuilds it, for
// the same reason `SseClient` did: iOS suspends the socket anyway, so holding
// it burns battery and leaves a stale handle that looks alive from JS. Every
// subscriber's cursor lives in the client, so the reconnect resumes rather
// than replaying.
// ────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { MuxStreamClient } from '@generatorai/client-core';

import { useAuth } from '../auth/AuthProvider';
import { createMobileMuxClient } from './muxTransport';
import { expoStreamFetch } from './expoStreamFetch';

const MuxStreamContext = createContext<MuxStreamClient | null>(null);

/**
 * The shared connection, or null before the session is authenticated.
 *
 * Null is a normal state, not an error: subscribers must simply not subscribe
 * yet. Throwing here would make every screen that streams unmountable during
 * pairing.
 */
export function useMuxStream(): MuxStreamClient | null {
  return useContext(MuxStreamContext);
}

export function MuxStreamProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { fetch, endpoint, state } = useAuth();
  const authenticated = state.status === 'authenticated';

  /**
   * Bumped on every foreground transition so the memo below builds a fresh
   * client. A counter rather than a boolean: two consecutive foregrounds must
   * produce two rebuilds, and a boolean that is already `true` would produce
   * none.
   */
  const [generation, setGeneration] = useState(0);
  const [foreground, setForeground] = useState(() => AppState.currentState !== 'background');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        setForeground(true);
        setGeneration((n) => n + 1);
      } else if (next === 'background') {
        setForeground(false);
      }
    });
    return () => subscription.remove();
  }, []);

  const client = useMemo(() => {
    if (!authenticated || !endpoint || !foreground) return null;
    return createMobileMuxClient({ fetch, endpoint, streamFetch: expoStreamFetch });
    // `generation` is a deliberate dependency: it is the foreground signal.
  }, [authenticated, endpoint, foreground, fetch, generation]);

  useEffect(() => {
    if (!client) return;
    return () => client.disposeAll();
  }, [client]);

  return <MuxStreamContext.Provider value={client}>{children}</MuxStreamContext.Provider>;
}

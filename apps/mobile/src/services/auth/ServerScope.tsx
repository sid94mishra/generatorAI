import React, { useLayoutEffect, useRef } from 'react';
import { router } from 'expo-router';
import { useAuth } from './AuthProvider';
import { resetStreamStore } from '../stream/streamStore';
import { consumePaired } from './pairingOutcome';

/** A server change starts at Home (or the pairing success step) with transient panels and stream records cleared. */
export function ServerScope({ children }: { children: React.ReactNode }): React.ReactElement {
  const { serverId, state } = useAuth();
  const previous = useRef(serverId);
  useLayoutEffect(() => {
    if (state.status !== 'authenticated' || previous.current === serverId) return;
    const switched = previous.current !== null;
    previous.current = serverId;
    resetStreamStore();
    // A server added from the pairing screen opens its success step; any other switch starts at Home.
    if (switched) router.replace(consumePaired() ? '/paired' : '/');
  }, [serverId, state.status]);
  return <>{children}</>;
}

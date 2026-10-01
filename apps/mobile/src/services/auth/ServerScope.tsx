import React, { useLayoutEffect, useRef } from 'react';
import { router } from 'expo-router';
import { useAuth } from './AuthProvider';
import { resetStreamStore } from '../stream/streamStore';

/** A server change starts at Home with transient panels and stream records cleared. */
export function ServerScope({ children }: { children: React.ReactNode }): React.ReactElement {
  const { serverId, state } = useAuth();
  const previous = useRef(serverId);
  useLayoutEffect(() => {
    if (state.status !== 'authenticated' || previous.current === serverId) return;
    const switched = previous.current !== null;
    previous.current = serverId;
    resetStreamStore();
    if (switched) router.replace('/');
  }, [serverId, state.status]);
  return <>{children}</>;
}

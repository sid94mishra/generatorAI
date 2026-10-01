import { useEffect, useRef, useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { linkQueue, linkDisposition, UNPAIRED_LINK_MESSAGE } from './links';

export function useLinkRouting(onError: (message: string) => void): boolean {
  const { serverId, servers, state, initializing, storageLocked, switchServer } = useAuth();
  const link = useSyncExternalStore(linkQueue.subscribe, linkQueue.getSnapshot, linkQueue.getSnapshot);
  const switching = useRef<string | null>(null);
  const report = useRef(onError);
  useEffect(() => { report.current = onError; }, [onError]);
  useEffect(() => {
    if (!link || initializing || storageLocked) return;
    const disposition = linkDisposition(link, servers.map((server) => server.serverId), serverId);
    if (disposition === 'unknown') {
      if (linkQueue.finish(link)) { router.replace('/'); report.current(UNPAIRED_LINK_MESSAGE); }
      return;
    }
    if (disposition === 'switch') {
      if (switching.current === link.serverId) return;
      switching.current = link.serverId;
      void switchServer(link.serverId!).catch((error: unknown) => {
        if (linkQueue.finish(link)) report.current(error instanceof Error ? error.message : 'Could not switch server');
      }).finally(() => { switching.current = null; });
      return;
    }
    if (state.status !== 'authenticated') return;
    if (linkQueue.finish(link)) router.replace(link.route as never);
  }, [link, serverId, servers, state.status, initializing, storageLocked, switchServer]);
  return link !== null;
}

import React, { useEffect, useState } from 'react';
import { MutationCache, onlineManager, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider, type Persister } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';
import { useAuth } from '../auth/AuthProvider';
import { createQueryPersister } from './queryPersister';
import { mayPersistQuery, QUERY_MAX_AGE, QUERY_SCHEMA_VERSION } from './queryPersistencePolicy';

const noPersistence: Persister = { persistClient() {}, restoreClient: () => undefined, removeClient() {} };

function ServerQueries({ serverId, children }: { serverId: string | null; children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    mutationCache: new MutationCache({ onMutate() { if (!onlineManager.isOnline()) throw new Error('Server offline'); } }),
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: QUERY_MAX_AGE, retry: 2, refetchOnWindowFocus: true, networkMode: 'online' },
      mutations: { retry: 0, networkMode: 'online' },
    },
  }));
  useEffect(() => () => { void client.cancelQueries(); client.clear(); }, [client]);
  const [persister] = useState(() => serverId ? createQueryPersister(serverId) : noPersistence);
  return <PersistQueryClientProvider client={client} persistOptions={{
    persister, maxAge: QUERY_MAX_AGE, buster: `${Constants.expoConfig?.version ?? '0'}:${QUERY_SCHEMA_VERSION}`,
    dehydrateOptions: { shouldDehydrateQuery: mayPersistQuery, shouldDehydrateMutation: () => false },
  }}>{children}</PersistQueryClientProvider>;
}

/** Server identity, not its LAN/relay address, partitions memory and encrypted storage. */
export function ServerQueryProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { serverId, state } = useAuth();
  const activeId = state.status === 'authenticated' ? serverId : null;
  return <ServerQueries key={activeId ?? 'unpaired'} serverId={activeId}>{children}</ServerQueries>;
}

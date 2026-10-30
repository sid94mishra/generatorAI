import { createMMKV } from 'react-native-mmkv';
import { loadCatalog, upsertConnection, removeConnection, type ConnectionCatalog, type ServerConnection } from '@generatorai/client-runtime';

export interface ServerRegistry {
  read(): ConnectionCatalog;
  add(server: ServerConnection): void;
  remove(id: string): void;
  select(id: string): void;
}

/** Reuse the landed shared catalog; this adapter exposes no credential storage. */
export function createServerRegistry(storage: Pick<Storage, 'getItem' | 'setItem'>): ServerRegistry {
  const read = () => loadCatalog({
    getItem: (key) => key === 'generatorai.connections' ? storage.getItem('servers.list') : null,
    setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
  });
  const write = (catalog: ConnectionCatalog) => {
    storage.setItem('servers.list', JSON.stringify(catalog));
    storage.setItem('servers.active', catalog.activeServerId ?? '');
  };
  return {
    read,
    add(server) { write(upsertConnection(read(), server)); },
    remove(id) { write(removeConnection(read(), id)); },
    select(id) {
      const catalog = read();
      if (!catalog.connections.some((server) => server.serverId === id)) throw new Error('Server is not paired');
      write({ ...catalog, activeServerId: id });
    },
  };
}

const storage = createMMKV({ id: 'servers' });
export const serverRegistry = createServerRegistry({
  getItem: (key) => storage.getString(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
});

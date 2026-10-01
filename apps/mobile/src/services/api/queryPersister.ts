import { createMMKV, deleteMMKV } from 'react-native-mmkv';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { Persister } from '@tanstack/react-query-persist-client';
import * as SecureStore from '../auth/secureItemStore';
import { trimPersistedPages } from './queryPersistencePolicy';

const active = new Map<string, Set<{ clear(): Promise<void> }>>();
const keyName = (id: string) => `mmkv.rq.${encodeURIComponent(id).replace(/%/g, '_')}`;

export function createQueryPersister(serverId: string): Persister {
  let cleared = false;
  const ready = (async () => {
    const name = keyName(serverId);
    let encryptionKey = await SecureStore.getItemAsync(name, SecureStore.KEYCHAIN_OPTIONS);
    if (!encryptionKey) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      encryptionKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => alphabet[byte & 63]).join('');
      if (cleared) return null;
      await SecureStore.setItemAsync(name, encryptionKey, SecureStore.KEYCHAIN_OPTIONS);
    }
    if (cleared) return null;
    const storage = createMMKV({ id: `rq-${serverId}`, encryptionKey, encryptionType: 'AES-256' });
    return createSyncStoragePersister({
      key: 'cache', throttleTime: 1000,
      storage: {
        getItem: (key) => cleared ? null : storage.getString(key) ?? null,
        setItem: (key, value) => { if (!cleared) storage.set(key, value); },
        removeItem: (key) => { if (!cleared) storage.remove(key); },
      },
      serialize: (client) => JSON.stringify(trimPersistedPages(client)),
    });
  })().catch(() => null); // Locked/unavailable keychain: memory-only, never plaintext fallback.
  const handles = active.get(serverId) ?? new Set<{ clear(): Promise<void> }>();
  active.set(serverId, handles);
  handles.add({ async clear() {
    cleared = true;
    await ready;
    deleteMMKV(`rq-${serverId}`);
    await SecureStore.deleteItemAsync(keyName(serverId), SecureStore.KEYCHAIN_OPTIONS);
  } });
  return {
    async persistClient(client) { (await ready)?.persistClient(client); },
    async restoreClient() { return (await ready)?.restoreClient(); },
    async removeClient() { (await ready)?.removeClient(); },
  };
}

export async function clearServerQueryCache(serverId: string): Promise<void> {
  const current = active.get(serverId);
  if (current) { await Promise.all([...current].map((handle) => handle.clear())); active.delete(serverId); }
  else {
    deleteMMKV(`rq-${serverId}`);
    await SecureStore.deleteItemAsync(keyName(serverId), SecureStore.KEYCHAIN_OPTIONS);
  }
}

import { afterEach, expect, it, vi } from 'vitest';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
const mocks = vi.hoisted(() => ({
  secrets: new Map<string, string>(), disks: new Map<string, Map<string, string>>(),
  configs: [] as Array<{ id: string; encryptionKey?: string; encryptionType?: string }>,
  locked: false,
}));
vi.mock('react-native-mmkv', () => ({
  createMMKV: (config: { id: string; encryptionKey?: string; encryptionType?: string }) => {
    mocks.configs.push(config);
    const disk = mocks.disks.get(config.id) ?? new Map<string, string>();
    mocks.disks.set(config.id, disk);
    return { getString: (key: string) => disk.get(key), set: (key: string, value: string) => disk.set(key, value), remove: (key: string) => disk.delete(key) };
  },
  deleteMMKV: (id: string) => mocks.disks.delete(id),
}));
vi.mock('../../auth/secureItemStore', () => ({
  KEYCHAIN_OPTIONS: {},
  getItemAsync: async (key: string) => { if (mocks.locked) throw new Error('locked'); return mocks.secrets.get(key) ?? null; },
  setItemAsync: async (key: string, value: string) => { mocks.secrets.set(key, value); },
  deleteItemAsync: async (key: string) => { mocks.secrets.delete(key); },
}));
import { createQueryPersister, clearServerQueryCache } from '../queryPersister';
const saved: PersistedClient = { timestamp: 1, buster: 'test', clientState: { queries: [], mutations: [] } };
afterEach(async () => { await clearServerQueryCache('a'); await clearServerQueryCache('b'); mocks.locked = false; vi.useRealTimers(); });
it('uses separate encrypted stores/keys and erases only the unpaired server', async () => {
  vi.useFakeTimers();
  const a = createQueryPersister('a');
  const b = createQueryPersister('b');
  await a.persistClient(saved);
  await b.persistClient({ ...saved, timestamp: 2 });
  await vi.runAllTimersAsync();
  expect((await a.restoreClient())?.timestamp).toBe(1);
  expect((await b.restoreClient())?.timestamp).toBe(2);
  const configs = mocks.configs.slice(-2);
  expect(configs.every((c) => c.encryptionType === 'AES-256' && c.encryptionKey?.length === 32)).toBe(true);
  expect(configs[0]?.encryptionKey).not.toBe(configs[1]?.encryptionKey);
  await a.persistClient({ ...saved, timestamp: 3 });
  await clearServerQueryCache('a');
  await vi.runAllTimersAsync();
  expect(mocks.disks.has('rq-a')).toBe(false);
  expect(mocks.secrets.has('mmkv.rq.a')).toBe(false);
  expect((await b.restoreClient())?.timestamp).toBe(2);
});
it('does not fall back to an unencrypted disk when protected storage is locked', async () => {
  mocks.locked = true;
  const before = mocks.configs.length;
  const a = createQueryPersister('a');
  await a.persistClient(saved);
  expect(await a.restoreClient()).toBeUndefined();
  expect(mocks.configs).toHaveLength(before);
});

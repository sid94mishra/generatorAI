import { expect, it, vi } from 'vitest';
import type { StoredSession } from '@generatorai/client-runtime';
const secrets = vi.hoisted(() => new Map<string, string>());
vi.mock('../secureItemStore', () => ({ IS_OS_PROTECTED: true, KEYCHAIN_OPTIONS: {}, getItemAsync: async (key: string) => secrets.get(key) ?? null, setItemAsync: async (key: string, value: string) => { secrets.set(key, value); }, deleteItemAsync: async (key: string) => { secrets.delete(key); } }));
vi.mock('../../native/deviceKeyModule', () => ({ NativeDeviceKey: { isSupported: async () => false } }));
import { MobileSessionStore } from '../stores';
const session = (serverId: string): StoredSession => ({ serverId, endpoint: 'http://localhost:3197', deviceId: `device-${serverId}`, deviceName: 'test', scopes: [], resumeSecret: `test-secret-${serverId}`, resumeExpiresAt: 1, credentialVersion: 1 });
it('does not read, overwrite or clear the other server credential', async () => {
  const a = new MobileSessionStore('a'); const b = new MobileSessionStore('b');
  await a.save(session('a')); await b.save(session('b'));
  await expect(a.save(session('b'))).rejects.toThrow('different server');
  expect((await a.load())?.serverId).toBe('a');
  await a.clear();
  expect(await a.load()).toBeNull();
  expect((await b.load())?.serverId).toBe('b');
  secrets.set('session.a', JSON.stringify(session('b')));
  expect(await a.load()).toBeNull();
});

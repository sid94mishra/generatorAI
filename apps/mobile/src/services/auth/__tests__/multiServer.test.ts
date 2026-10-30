import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native-mmkv', () => ({ createMMKV: () => ({ getString: () => undefined, set: vi.fn() }) }));
import { createServerRegistry } from '../serverRegistry';
import { serverStorageKeys } from '../serverStorageKeys';
import { registerAuthenticatedFetch, setBackgroundActiveServer, getAuthenticatedFetch, clearAuthenticatedFetches } from '../backgroundFetch';
import { nextRestorePhase } from '../restoreState';
const connection = (serverId: string, endpoint: string) => ({ serverId, endpoint, endpoints: [endpoint], label: serverId, kind: 'remote' as const, managed: false, lastConnectedAt: 1 });
afterEach(clearAuthenticatedFetches);
describe('mobile server isolation', () => {
  it('keeps registry entries by host identity and selects/removes one without losing the other', () => {
    const disk = new Map<string, string>();
    const registry = createServerRegistry({ getItem: (key) => disk.get(key) ?? null, setItem: (key, value) => { disk.set(key, value); } });
    registry.add(connection('a', 'http://localhost:3197'));
    registry.add(connection('b', 'http://localhost:3297'));
    registry.add(connection('a', 'http://new-lan:3197'));
    expect(registry.read().connections).toHaveLength(2);
    expect(registry.read().connections[0]?.endpoints).toContain('http://localhost:3197');
    registry.select('b');
    expect(registry.read().activeServerId).toBe('b');
    registry.remove('a');
    expect(registry.read().connections.map((c) => c.serverId)).toEqual(['b']);
    expect(registry.read().activeServerId).toBe('b');
    expect(() => registry.select('unknown')).toThrow('Server is not paired');
  });
  it('isolates sessions, software keys and native aliases, rejecting addresses as identities', () => {
    const a = Object.values(serverStorageKeys('a')); const b = Object.values(serverStorageKeys('b'));
    expect(a.some((key) => b.includes(key))).toBe(false);
    expect(() => serverStorageKeys('http://localhost:3197')).toThrow();
    expect(() => serverStorageKeys('../a')).toThrow();
  });
  it('routes a B notification to B while A is active and rejects ambiguous legacy actions', async () => {
    const a = vi.fn(async () => new Response('A')); const b = vi.fn(async () => new Response('B'));
    registerAuthenticatedFetch('a', a); setBackgroundActiveServer('a');
    expect(getAuthenticatedFetch()).toBe(a);
    registerAuthenticatedFetch('b', b);
    expect(getAuthenticatedFetch()).toBeNull();
    expect(await (await getAuthenticatedFetch('b')!('/api/chats/b')) .text()).toBe('B');
    expect(a).not.toHaveBeenCalled();
    registerAuthenticatedFetch('b', null);
    expect(getAuthenticatedFetch('b')).toBeNull();
    expect(getAuthenticatedFetch()).toBe(a);
  });
  it('holds the route gate during an explicit server switch without restarting on ordinary focus', () => {
    expect(nextRestorePhase('settled', { type: 'server-switch' })).toBe('restoring');
    expect(nextRestorePhase('settled', { type: 'retry' })).toBe('settled');
  });
});

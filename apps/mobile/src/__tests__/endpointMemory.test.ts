import { describe, expect, it } from 'vitest';

import { orderEndpoints, rememberEndpoint, rememberedEndpoint } from '../services/transport/endpointMemory';

const TS = 'https://studio.tail1234.ts.net';
const LAN = 'https://192.168.0.111:3197';
const LOCAL = 'https://studio.local:3197';

describe('endpoint order and memory (MD-203)', () => {
  it('keeps the offer order when nothing answered yet (ts.net first, then LAN)', () => {
    expect(orderEndpoints([TS, LAN, LOCAL, 'http://127.0.0.1:3197'], null)).toEqual([TS, LAN, LOCAL]);
  });

  it('puts the address that answered first, then the rest in order', () => {
    expect(orderEndpoints([TS, LAN, LOCAL], LAN)).toEqual([LAN, TS, LOCAL]);
  });

  it('ignores a remembered address the server no longer lists, and drops plain HTTP to another device', () => {
    expect(orderEndpoints([TS, LAN, 'http://192.168.0.111:3197'], 'https://10.0.0.9:3197')).toEqual([TS, LAN]);
    expect(orderEndpoints([TS, TS, LAN], 'http://192.168.0.111:3197')).toEqual([TS, LAN]);
  });

  it('remembers per server', () => {
    const disk = new Map<string, string>();
    const store = { getString: (key: string) => disk.get(key), setString: (key: string, value: string) => void disk.set(key, value) };
    expect(rememberedEndpoint(store, 'a')).toBeNull();
    rememberEndpoint(store, 'a', LAN);
    rememberEndpoint(store, 'b', TS);
    expect(rememberedEndpoint(store, 'a')).toBe(LAN);
    expect(rememberedEndpoint(store, 'b')).toBe(TS);
    expect([...disk.keys()]).toEqual(['srv.a.endpoint.last', 'srv.b.endpoint.last']);
  });
});

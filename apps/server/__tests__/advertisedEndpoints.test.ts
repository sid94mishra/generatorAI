import { describe, expect, it } from 'vitest';
import {
  resolveAdvertisedEndpoints,
  selectPairingEndpoint,
  type NetworkInterfaces,
} from '../src/network/advertisedEndpoints.js';

function interfaces(entries: Record<string, Array<Partial<NetworkInterfaces[string][number]>>>): NetworkInterfaces {
  return Object.fromEntries(
    Object.entries(entries).map(([name, addresses]) => [
      name,
      addresses.map((address) => ({
        address: address.address ?? '192.168.1.10',
        family: address.family ?? 'IPv4',
        internal: address.internal ?? false,
        netmask: address.netmask ?? '255.255.255.0',
        mac: address.mac ?? '00:00:00:00:00:00',
        cidr: address.cidr ?? null,
      })),
    ]),
  );
}

describe('resolveAdvertisedEndpoints', () => {
  it('orders configured endpoints, all usable LAN interfaces, then loopback', () => {
    const endpoints = resolveAdvertisedEndpoints({
      port: 3100,
      bindHost: '0.0.0.0',
      configuredOrigins: ['https://host.example.test/', 'not a URL'],
      networkInterfaces: interfaces({
        Ethernet: [{ address: '192.168.1.20' }],
        WiFi: [{ address: '10.0.0.8' }],
        APIPA: [{ address: '169.254.4.1' }],
        Public: [{ address: '203.0.113.8' }],
        Loopback: [{ address: '127.0.0.1', internal: true }],
      }),
    });

    expect(endpoints.map((endpoint) => endpoint.origin)).toEqual([
      'https://host.example.test',
      'http://192.168.1.20:3100',
      'http://10.0.0.8:3100',
      'http://127.0.0.1:3100',
    ]);
    expect(endpoints.map((endpoint) => endpoint.reachability)).toEqual([
      'public',
      'lan',
      'lan',
      'loopback',
    ]);
  });

  it('advertises a specifically bound host and deduplicates configured origins', () => {
    const endpoints = resolveAdvertisedEndpoints({
      port: 3100,
      bindHost: '192.168.50.4',
      configuredOrigins: ['http://192.168.50.4:3100/'],
      networkInterfaces: {},
    });

    expect(endpoints.map((endpoint) => endpoint.origin)).toEqual([
      'http://192.168.50.4:3100',
      'http://127.0.0.1:3100',
    ]);
  });

  it('never selects loopback for a mobile pairing', () => {
    const endpoints = resolveAdvertisedEndpoints({
      port: 3100,
      bindHost: '127.0.0.1',
      networkInterfaces: {},
    });

    expect(selectPairingEndpoint(endpoints, 'mobile')).toBeNull();
    expect(selectPairingEndpoint(endpoints, 'desktop')?.origin).toBe('http://127.0.0.1:3100');
  });
});
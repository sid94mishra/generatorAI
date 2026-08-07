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

  it('flags hypervisor adapters and ranks real network cards ahead of them', () => {
    // WSL/Hyper-V/Docker switches hand out RFC1918 addresses that look exactly
    // like a LAN address but route nowhere off this machine. Advertising one
    // to a phone produces a silent connection timeout.
    const endpoints = resolveAdvertisedEndpoints({
      port: 3100,
      bindHost: '0.0.0.0',
      networkInterfaces: interfaces({
        'vEthernet (WSL (Hyper-V firewall))': [{ address: '172.19.144.1' }],
        'vEthernet (Default Switch)': [{ address: '172.18.144.1' }],
        'Wi-Fi': [{ address: '192.168.0.107' }],
      }),
    });

    // Real adapter first even though the OS enumerated it last.
    expect(endpoints[0]?.origin).toBe('http://192.168.0.107:3100');
    expect(endpoints[0]?.virtual).toBe(false);

    const virtualOrigins = endpoints.filter((e) => e.virtual).map((e) => e.origin);
    expect(virtualOrigins).toEqual([
      'http://172.19.144.1:3100',
      'http://172.18.144.1:3100',
    ]);
  });

  it('never hands a phone a host-only virtual address', () => {
    const endpoints = resolveAdvertisedEndpoints({
      port: 3100,
      bindHost: '0.0.0.0',
      networkInterfaces: interfaces({
        'vEthernet (WSL)': [{ address: '172.19.144.1' }],
      }),
    });

    // Only a virtual adapter and loopback exist, so there is genuinely nothing
    // a phone can reach — better to refuse than to advertise a dead address.
    expect(selectPairingEndpoint(endpoints, 'mobile')).toBeNull();
  });
});
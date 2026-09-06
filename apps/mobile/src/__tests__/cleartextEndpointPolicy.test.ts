// `android.usesCleartextTraffic: true` (app.config.ts) is only acceptable
// because the app never talks to an endpoint the pairing schema did not
// accept, and that schema allows plain `http:` for loopback / RFC1918 /
// `.local` hosts only. If this test fails, the cleartext flag has lost its
// justification and a network-security-config must replace it.

import { describe, expect, it } from 'vitest';
import { PairingEndpointSchema } from '@generatorai/relay-protocol';

const accepts = (origin: string): boolean =>
  PairingEndpointSchema.safeParse({ origin, reachability: 'lan', priority: 0 }).success;

describe('cleartext pairing endpoint policy (Android usesCleartextTraffic justification)', () => {
  it('allows plain http only on loopback, RFC1918 and .local hosts', () => {
    for (const origin of [
      'http://127.0.0.1:3100',
      'http://localhost:3100',
      'http://10.0.2.2:3100',
      'http://10.1.2.3:3100',
      'http://192.168.0.107:3100',
      'http://172.16.5.5:3100',
      'http://172.31.0.1:3100',
      'http://studio.local:3100',
    ]) {
      expect(accepts(origin), origin).toBe(true);
    }
  });

  it('refuses plain http to anything public', () => {
    for (const origin of [
      'http://example.com',
      'http://8.8.8.8:3100',
      'http://172.32.0.1:3100',
      'http://192.169.0.1:3100',
      'http://evil.local.example.com',
    ]) {
      expect(accepts(origin), origin).toBe(false);
    }
  });

  it('still accepts https anywhere', () => {
    expect(accepts('https://studio.example')).toBe(true);
  });
});

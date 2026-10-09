// Audit F-7: the server rebuilds the request URL (DPoP `htu`, the transport
// policy, HSTS redirects) with a lower-cased host, the same way the client's
// URL parser canonicalises the one it signed.

import { describe, expect, it } from 'vitest';
import { parseTrustProxy, requestAbsoluteUrl, requestOrigin } from '../network/requestOrigin.js';
import { classifyTransport } from '../middleware/transportPolicy.js';

const off = parseTrustProxy(undefined);

describe('request origin host case (F-7)', () => {
  it('lower-cases the Host header and a trusted proxy’s X-Forwarded-Host', () => {
    const direct = { headers: { host: 'Studio-MAC.local:3100' }, socket: { remoteAddress: '192.168.1.9' } };
    expect(requestOrigin(direct, off).host).toBe('studio-mac.local:3100');
    expect(requestAbsoluteUrl(direct, '/api/Chats', off)).toBe('http://studio-mac.local:3100/api/Chats');

    const proxied = {
      headers: { host: '127.0.0.1:3100', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'Gen.Example.ORG' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(requestAbsoluteUrl(proxied, '/api/x', parseTrustProxy('loopback'))).toBe('https://gen.example.org/api/x');
  });

  it('matches the native lane’s own-origin header case-insensitively', () => {
    const req = {
      headers: { host: 'Studio-Mac.local:3100', origin: 'http://studio-mac.LOCAL:3100' },
      socket: { remoteAddress: '192.168.1.9' },
    };
    expect(classifyTransport(req, off)).toBe('native-lan');
  });
});

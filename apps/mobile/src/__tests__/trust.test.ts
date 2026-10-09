import { describe, expect, it } from 'vitest';

import {
  anchorTargets,
  assertSecureEndpoints,
  diagnoseConnection,
  endpointSecurity,
  hostPortOf,
  InsecureEndpointError,
  isLocalNetworkHost,
  isPinnableHost,
  parseTrustRecord,
  shortFingerprint,
  trustRecord,
  usableEndpoints,
} from '../services/transport/trust';

const CA = 'q3CTw2fV7a4oYFyJb0n7m6S1tGZJ2s1rQyQ0bW8b9kM';
const BACKUP = 'Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eHF1dXg';

describe('endpoint security (MD-201)', () => {
  it('allows https anywhere and plain HTTP only to this device', () => {
    expect(endpointSecurity('https://192.168.1.10:3100')).toBe('tls');
    expect(endpointSecurity('https://studio.tail1234.ts.net')).toBe('tls');
    expect(endpointSecurity('http://127.0.0.1:3197')).toBe('loopback');
    expect(endpointSecurity('http://localhost:3100')).toBe('loopback');
    expect(endpointSecurity('http://[::1]:3100')).toBe('loopback');
    expect(endpointSecurity('http://192.168.1.10:3100')).toBe('plain');
    expect(endpointSecurity('http://10.0.2.2:3197')).toBe('plain');
    expect(endpointSecurity('http://studio.local:3100')).toBe('plain');
    expect(endpointSecurity('ftp://192.168.1.10')).toBe('plain');
    expect(endpointSecurity('not a url')).toBe('plain');
  });

  it('drops plain endpoints and refuses a list with nothing left', () => {
    expect(usableEndpoints(['http://192.168.1.10:3100', 'https://192.168.1.10:3100', 'http://127.0.0.1:3100'])).toEqual([
      'https://192.168.1.10:3100',
      'http://127.0.0.1:3100',
    ]);
    expect(() => assertSecureEndpoints(['http://192.168.1.10:3100'])).toThrow(InsecureEndpointError);
    expect(() => assertSecureEndpoints(['http://192.168.1.10:3100', 'https://192.168.1.10:3100'])).not.toThrow();
  });
});

describe('pinnable hosts = the local CA name constraints (D-110)', () => {
  it.each([
    '10.0.0.1', '10.0.2.2', '172.16.0.1', '172.31.255.255', '192.168.0.107', '127.0.0.1', '100.64.0.1', '100.127.1.1',
    'localhost', 'studio.local', 'STUDIO.LOCAL.', '::1', '[::1]', 'fd12:3456::1', 'fc00::1',
  ])('%s is anchored to the CA', (host) => expect(isPinnableHost(host)).toBe(true));

  it.each(['8.8.8.8', '172.32.0.1', '192.169.0.1', '100.128.0.1', 'studio.tail1234.ts.net', 'example.com', 'local.example.com', '2001:db8::1'])(
    '%s keeps the system trust',
    (host) => expect(isPinnableHost(host)).toBe(false),
  );

  it('separates the LAN (Local Network privacy) from this device', () => {
    expect(isLocalNetworkHost('192.168.1.10')).toBe(true);
    expect(isLocalNetworkHost('studio.local')).toBe(true);
    expect(isLocalNetworkHost('127.0.0.1')).toBe(false);
    expect(isLocalNetworkHost('studio.tail1234.ts.net')).toBe(false);
  });
});

describe('trust records and anchors', () => {
  it('keeps well-formed fingerprints once, from the QR CA and its backup', () => {
    expect(trustRecord([CA, BACKUP, CA, undefined, null, 'short'], 'qr')).toEqual({ v: 1, fingerprints: [CA, BACKUP], source: 'qr' });
  });

  it('round-trips through storage and rejects anything else', () => {
    const record = trustRecord([CA], 'certificate');
    expect(parseTrustRecord(JSON.stringify(record))).toEqual(record);
    expect(parseTrustRecord(null)).toBeNull();
    expect(parseTrustRecord('{')).toBeNull();
    expect(parseTrustRecord(JSON.stringify({ v: 2, fingerprints: [CA], source: 'qr' }))).toBeNull();
    expect(parseTrustRecord(JSON.stringify({ v: 1, fingerprints: [CA], source: 'tofu' }))).toBeNull();
  });

  it('anchors only https endpoints inside the CA constraints, keyed host:port', () => {
    const record = trustRecord([CA], 'qr');
    expect(
      anchorTargets(record, [
        'https://192.168.1.10:3100',
        'https://Studio.local:3100',
        'https://studio.tail1234.ts.net',
        'http://127.0.0.1:3100',
        'https://[fd00::5]:3100',
        'https://192.168.1.10:3100/',
      ]),
    ).toEqual(['192.168.1.10:3100', 'studio.local:3100', 'fd00::5:3100']);
    expect(anchorTargets(trustRecord([], 'qr'), ['https://192.168.1.10:3100'])).toEqual([]);
    expect(anchorTargets(null, ['https://192.168.1.10:3100'])).toEqual([]);
  });

  it('parses default ports', () => {
    expect(hostPortOf('https://studio.local')).toMatchObject({ host: 'studio.local', port: 443, key: 'studio.local:443', secure: true });
    expect(hostPortOf('http://127.0.0.1')).toMatchObject({ port: 80, secure: false });
    expect(hostPortOf('mailto:x')).toBeNull();
  });
});

describe('diagnoseConnection (MD-202)', () => {
  const record = trustRecord([CA], 'qr');
  const endpoints = ['https://192.168.1.10:3100', 'https://studio.local:3100'];

  it('names a plain-HTTP pairing before anything is tried', () => {
    expect(diagnoseConnection({ endpoints: ['http://192.168.1.10:3100'], record: null, since: 0, lastFailure: () => 0 })).toBe('insecure-endpoint');
  });

  it('names a refused certificate only for a failure during this attempt', () => {
    const failedAt = (at: number) => (host: string, port: number) => (host === 'studio.local' && port === 3100 ? at : 0);
    expect(diagnoseConnection({ endpoints, record, since: 1_000, lastFailure: failedAt(1_500) })).toBe('certificate-changed');
    expect(diagnoseConnection({ endpoints, record, since: 2_000, lastFailure: failedAt(1_500) })).toBeNull();
    expect(diagnoseConnection({ endpoints, record, since: 1_000, lastFailure: () => 0 })).toBeNull();
  });

  it('never blames the certificate of an unpinned server', () => {
    expect(diagnoseConnection({ endpoints, record: trustRecord([], 'qr'), since: 0, lastFailure: () => 5 })).toBeNull();
  });
});

describe('shortFingerprint', () => {
  it('prints the first 8 bytes as browsers do', () => {
    // 0x3f a9 1c 07 88 2b d4 e1 …
    const bytes = Uint8Array.from([0x3f, 0xa9, 0x1c, 0x07, 0x88, 0x2b, 0xd4, 0xe1, ...new Array(24).fill(0)]);
    const base64url = Buffer.from(bytes).toString('base64url');
    expect(shortFingerprint(base64url)).toBe('3F A9 1C 07 88 2B D4 E1 …');
  });
});

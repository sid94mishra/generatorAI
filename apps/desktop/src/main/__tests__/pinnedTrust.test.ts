// G-4 (D-126): the verify proc accepts exactly the pinned CA for exactly that
// server's host; everything else keeps Chromium's verdict.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VERIFY_ACCEPT,
  VERIFY_USE_CHROMIUM,
  base64UrlToPairs,
  leafMatchesPin,
  pinForCa,
  verifyWithPins,
} from '../pinnedTrust';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'pinned', name), 'utf8');
const caA = fixture('ca-a.crt');
const caB = fixture('ca-b.crt');
const leafA = fixture('leaf-a.crt'); // CA A, SANs 192.168.1.20 + studio.local
const leafB = fixture('leaf-b.crt'); // CA B, same names: an impersonator
const NOW = Date.parse('2026-10-09T12:00:00Z');
const pinA = pinForCa(caA, NOW);
const servers = [{ url: 'https://192.168.1.20:3100', pinnedCa: pinA }];
const failed = 'net::ERR_CERT_AUTHORITY_INVALID';

describe('verifyWithPins', () => {
  it('accepts the pinned CA’s leaf for the pinned host', () => {
    expect(verifyWithPins({ hostname: '192.168.1.20', verificationResult: failed, certificatePem: leafA }, servers, NOW)).toBe(VERIFY_ACCEPT);
  });

  it('refuses a leaf from another CA with the very same names', () => {
    expect(verifyWithPins({ hostname: '192.168.1.20', verificationResult: failed, certificatePem: leafB }, servers, NOW)).toBe(VERIFY_USE_CHROMIUM);
  });

  it('never vouches for a host it was not pinned for (no blanket trust)', () => {
    // leafA names studio.local too, but only 192.168.1.20 was pinned.
    expect(verifyWithPins({ hostname: 'studio.local', verificationResult: failed, certificatePem: leafA }, servers, NOW)).toBe(VERIFY_USE_CHROMIUM);
    expect(verifyWithPins({ hostname: '192.168.1.99', verificationResult: failed, certificatePem: leafA }, servers, NOW)).toBe(VERIFY_USE_CHROMIUM);
    expect(verifyWithPins({ hostname: '192.168.1.20', verificationResult: failed, certificatePem: leafA }, [], NOW)).toBe(VERIFY_USE_CHROMIUM);
  });

  it('keeps Chromium’s own OK (a ts.net or other public certificate) untouched', () => {
    expect(verifyWithPins({ hostname: 'studio.tail1234.ts.net', verificationResult: 'net::OK', certificatePem: leafB }, servers, NOW)).toBe(VERIFY_USE_CHROMIUM);
  });

  it('refuses outside the leaf’s validity window', () => {
    const later = Date.parse('2028-01-01T00:00:00Z');
    expect(verifyWithPins({ hostname: '192.168.1.20', verificationResult: failed, certificatePem: leafA }, servers, later)).toBe(VERIFY_USE_CHROMIUM);
  });

  it('refuses a tampered pin (stored CA no longer hashes to the fingerprint)', () => {
    const tampered = [{ url: 'https://192.168.1.20:3100', pinnedCa: { ...pinA, pem: caB } }];
    expect(verifyWithPins({ hostname: '192.168.1.20', verificationResult: failed, certificatePem: leafB }, tampered, NOW)).toBe(VERIFY_USE_CHROMIUM);
  });

  it('refuses the CA certificate presented as the leaf, and garbage', () => {
    expect(leafMatchesPin(caA, '192.168.1.20', pinA, NOW)).toBe(false);
    expect(leafMatchesPin('not a certificate', '192.168.1.20', pinA, NOW)).toBe(false);
  });

  it('matches hosts case-insensitively and IPv6 brackets aside', () => {
    const named = [{ url: 'https://Studio.local:3100', pinnedCa: pinA }];
    expect(verifyWithPins({ hostname: 'STUDIO.LOCAL', verificationResult: failed, certificatePem: leafA }, named, NOW)).toBe(VERIFY_ACCEPT);
  });

  it('formats a fingerprint in byte pairs', () => {
    expect(base64UrlToPairs(pinA.sha256).split(' ')).toHaveLength(32);
  });
});

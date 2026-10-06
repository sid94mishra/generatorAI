// ────────────────────────────────────────────────────────────────
// Built-in LAN HTTPS — certificate generation, SAN selection, renewal and
// bring-your-own validation (D-110, D-113).
// ────────────────────────────────────────────────────────────────

import * as tls from 'node:tls';
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { MemorySecretStore } from '@generatorai/secrets';
import {
  generateLocalCa,
  issueLeafCertificate,
  describeCertificate,
  isIssuedBy,
  LEAF_VALIDITY_DAYS,
  type CertificateKeyPair,
} from '../network/tls/certificates.js';
import { mdnsHostname, selectCertificateNames } from '../network/tls/certificateNames.js';
import { validateCustomCertificate, CustomCertificateError } from '../network/tls/customCertificate.js';
import { TlsManager, TLS_SECRET_NAMESPACE } from '../network/tls/TlsManager.js';

const DAY = 24 * 60 * 60_000;

function iface(address: string, family: 'IPv4' | 'IPv6', internal = false): NetworkInterfaceInfo {
  return family === 'IPv4'
    ? { address, family, internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` }
    : { address, family, internal, netmask: 'ffff:ffff:ffff:ffff::', mac: '00:00:00:00:00:00', cidr: `${address}/64`, scopeid: 0 };
}

/** Connects with `ca` as the only trust anchor; resolves with the verification error, or null. */
async function verifyAgainst(ca: string, pair: CertificateKeyPair, chain: string, host: string): Promise<string | null> {
  const server = tls.createServer({ key: pair.keyPem, cert: chain }, (socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    return await new Promise<string | null>((resolve) => {
      const socket = tls.connect(
        { host: '127.0.0.1', port, ca, checkServerIdentity: (_h, cert) => tls.checkServerIdentity(host, cert) },
        () => {
          socket.end();
          resolve(null);
        },
      );
      socket.on('error', (err) => resolve(err.message));
    });
  } finally {
    server.close();
  }
}

describe('certificate generation (D-110)', () => {
  it('issues a leaf for the LAN names, signed by a name-constrained local CA', async () => {
    const ca = await generateLocalCa({ commonName: 'GeneratorAI local CA (test)' });
    const leaf = await issueLeafCertificate({
      ca,
      names: { dnsNames: ['box.local', 'localhost'], ipAddresses: ['192.168.1.20', 'fd00::5', '127.0.0.1', '::1'] },
      commonName: 'box.local',
    });
    const summary = describeCertificate(leaf.certPem);
    expect(summary.dnsNames).toEqual(['box.local', 'localhost']);
    expect(summary.ipAddresses).toEqual(['192.168.1.20', 'fd00::5', '127.0.0.1', '::1']);
    expect(summary.notAfter - summary.notBefore).toBeLessThanOrEqual((LEAF_VALIDITY_DAYS + 1) * DAY);
    expect(summary.fingerprintSha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(isIssuedBy(leaf.certPem, ca.certPem)).toBe(true);
    // A client trusting only the CA accepts the leaf by IP and by name.
    await expect(verifyAgainst(ca.certPem, leaf, leaf.certPem + ca.certPem, '127.0.0.1')).resolves.toBeNull();
    await expect(verifyAgainst(ca.certPem, leaf, leaf.certPem + ca.certPem, 'localhost')).resolves.toBeNull();
    // Private keys are PKCS#8 PEM, never part of a certificate.
    expect(leaf.keyPem).toContain('BEGIN PRIVATE KEY');
    expect(leaf.certPem).not.toContain('PRIVATE KEY');
  });

  it('the CA cannot vouch for a public name even when trusted (name constraints)', async () => {
    const ca = await generateLocalCa({ commonName: 'GeneratorAI local CA (test)' });
    const rogue = await issueLeafCertificate({
      ca,
      names: { dnsNames: ['bank.example'], ipAddresses: ['127.0.0.1', '8.8.8.8'] },
      commonName: 'bank.example',
    });
    const error = await verifyAgainst(ca.certPem, rogue, rogue.certPem + ca.certPem, '127.0.0.1');
    expect(error).toMatch(/subtree|constraint/i);
  });
});

describe('certificate names (SAN selection)', () => {
  it('takes private IPv4 and unique-local IPv6, skips internal, link-local and public addresses', () => {
    const names = selectCertificateNames({
      hostname: 'Sids-MacBook-Pro.local',
      networkInterfaces: {
        lo0: [iface('127.0.0.1', 'IPv4', true), iface('::1', 'IPv6', true)],
        en0: [iface('192.168.1.20', 'IPv4'), iface('fe80::1', 'IPv6'), iface('fd12:3456::9', 'IPv6'), iface('2001:db8::1', 'IPv6')],
        vEthernet: [iface('172.20.0.1', 'IPv4')],
        wan: [iface('203.0.113.7', 'IPv4')],
      },
    });
    expect(names.dnsNames).toEqual(['sids-macbook-pro.local', 'localhost']);
    expect(names.ipAddresses).toEqual(['172.20.0.1', '192.168.1.20', 'fd12:3456::9', '127.0.0.1', '::1']);
  });

  it('derives <host>.local only from a hostname that is a valid DNS label', () => {
    expect(mdnsHostname('DESKTOP-AB12')).toBe('desktop-ab12.local');
    expect(mdnsHostname('box.corp.example')).toBe('box.local');
    expect(mdnsHostname('My PC')).toBeNull();
    expect(mdnsHostname('under_score')).toBeNull();
  });
});

function managerFor(store: MemorySecretStore, state: { addresses: string[]; now: number; hostname?: string }) {
  return new TlsManager({
    secretStore: store,
    logger: { info: () => undefined, warn: () => undefined },
    hostname: () => state.hostname ?? 'box',
    networkInterfaces: () => ({ en0: state.addresses.map((a) => iface(a, 'IPv4')) }),
    advertisedHosts: () => [],
    now: () => state.now,
  });
}

describe('TlsManager — persistence and renewal', () => {
  it('creates the CA and leaf once and keeps them in the vault, not on disk', async () => {
    const store = new MemorySecretStore();
    const state = { addresses: ['192.168.1.20'], now: Date.now() };
    const first = managerFor(store, state);
    await first.initialize();
    const status = first.status();
    expect(status.source).toBe('generated');
    expect(status.names).toEqual(expect.arrayContaining(['box.local', 'localhost', '192.168.1.20', '127.0.0.1', '::1']));
    expect(status.caFingerprintSha256).toBe(first.pinnedFingerprint());
    expect((await store.list(TLS_SECRET_NAMESPACE)).sort()).toEqual(['leaf', 'local-ca']);

    // A restart on the same network re-uses both: the browser's accepted
    // exception and any pinned fingerprint keep working.
    const second = managerFor(store, state);
    await second.initialize();
    expect(second.status().fingerprintSha256).toBe(status.fingerprintSha256);
    expect(second.status().caFingerprintSha256).toBe(status.caFingerprintSha256);
  });

  it('re-issues the leaf when the LAN address changes, under the same CA', async () => {
    const store = new MemorySecretStore();
    const state = { addresses: ['192.168.1.20'], now: Date.now() };
    const manager = managerFor(store, state);
    await manager.initialize();
    const before = manager.status();
    const version = manager.version;

    await expect(manager.refresh()).resolves.toBe(false);
    state.addresses = ['10.0.0.7'];
    await expect(manager.refresh()).resolves.toBe(true);

    const after = manager.status();
    expect(after.fingerprintSha256).not.toBe(before.fingerprintSha256);
    expect(after.caFingerprintSha256).toBe(before.caFingerprintSha256);
    expect(after.names).toContain('10.0.0.7');
    expect(after.names).not.toContain('192.168.1.20');
    expect(manager.version).toBeGreaterThan(version);
  });

  it('re-issues a leaf that is within 30 days of expiry', async () => {
    const store = new MemorySecretStore();
    const state = { addresses: ['192.168.1.20'], now: Date.now() };
    const manager = managerFor(store, state);
    await manager.initialize();
    const before = manager.status();
    state.now += (LEAF_VALIDITY_DAYS - 20) * DAY;
    await expect(manager.refresh()).resolves.toBe(true);
    expect(manager.status().notAfter).toBeGreaterThan(before.notAfter);
    expect(manager.status().caFingerprintSha256).toBe(before.caFingerprintSha256);
  });
});

describe('bring your own certificate (D-113)', () => {
  const lanNames = { dnsNames: ['box.local', 'localhost'], ipAddresses: ['192.168.1.20', '127.0.0.1', '::1'] };

  async function otherCa() {
    return generateLocalCa({ commonName: 'Company CA (test)' });
  }

  it('accepts a certificate that matches its key and covers a LAN name, and serves it', async () => {
    const ca = await otherCa();
    const leaf = await issueLeafCertificate({ ca, names: { dnsNames: ['box.local'], ipAddresses: [] }, commonName: 'box.local' });
    const store = new MemorySecretStore();
    const manager = managerFor(store, { addresses: ['192.168.1.20'], now: Date.now() });
    await manager.initialize();
    const generated = manager.status();

    // Chain given intermediate-first: the leaf is found by its key and moved to the front.
    const status = await manager.installCustomCertificate(ca.certPem + leaf.certPem, leaf.keyPem);
    expect(status.source).toBe('custom');
    expect(status.fingerprintSha256).toBe(describeCertificate(leaf.certPem).fingerprintSha256);
    expect(status.caFingerprintSha256).toBeNull();
    expect(manager.pinnedFingerprint()).toBeNull();
    await expect(verifyAgainst(ca.certPem, leaf, leaf.certPem, 'box.local')).resolves.toBeNull();

    // It survives a restart, and removing it brings the generated one back.
    const restarted = managerFor(store, { addresses: ['192.168.1.20'], now: Date.now() });
    await restarted.initialize();
    expect(restarted.status().source).toBe('custom');
    const back = await restarted.removeCustomCertificate();
    expect(back.source).toBe('generated');
    expect(back.caFingerprintSha256).toBe(generated.caFingerprintSha256);
  });

  it('advertises a tailscale-style name whose first label is this host', async () => {
    const ca = await otherCa();
    const leaf = await issueLeafCertificate({
      ca,
      names: { dnsNames: ['box.tail1234.ts.net'], ipAddresses: [] },
      commonName: 'box.tail1234.ts.net',
    });
    const result = validateCustomCertificate({ certPem: leaf.certPem, keyPem: leaf.keyPem, lanNames, advertisedHosts: [], hostname: 'box' });
    expect(result.extraHostnames).toEqual(['box.tail1234.ts.net']);
  });

  const rejects = async (fn: () => unknown, code: string) => {
    try {
      await fn();
      throw new Error('expected a rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(CustomCertificateError);
      expect((err as CustomCertificateError).code).toBe(code);
    }
  };

  it('rejects a key that does not belong to the certificate', async () => {
    const ca = await otherCa();
    const a = await issueLeafCertificate({ ca, names: { dnsNames: ['box.local'], ipAddresses: [] }, commonName: 'a' });
    const b = await issueLeafCertificate({ ca, names: { dnsNames: ['box.local'], ipAddresses: [] }, commonName: 'b' });
    await rejects(() => validateCustomCertificate({ certPem: a.certPem, keyPem: b.keyPem, lanNames, advertisedHosts: [], hostname: 'box' }), 'KEY_MISMATCH');
  });

  it('rejects a certificate for another machine, naming what it covers', async () => {
    const ca = await otherCa();
    const leaf = await issueLeafCertificate({ ca, names: { dnsNames: ['other.local'], ipAddresses: ['192.168.1.99'] }, commonName: 'other' });
    await rejects(() => validateCustomCertificate({ certPem: leaf.certPem, keyPem: leaf.keyPem, lanNames, advertisedHosts: [], hostname: 'box' }), 'NAME_MISMATCH');
    // ...unless an advertised URL names it.
    expect(() =>
      validateCustomCertificate({ certPem: leaf.certPem, keyPem: leaf.keyPem, lanNames, advertisedHosts: ['other.local'], hostname: 'box' }),
    ).not.toThrow();
  });

  it('rejects an expired certificate, a CA certificate, an encrypted key and garbage', async () => {
    const ca = await otherCa();
    const old = await issueLeafCertificate({ ca, names: { dnsNames: ['box.local'], ipAddresses: [] }, commonName: 'old', now: Date.now() - 400 * DAY });
    await rejects(() => validateCustomCertificate({ certPem: old.certPem, keyPem: old.keyPem, lanNames, advertisedHosts: [], hostname: 'box' }), 'EXPIRED');
    await rejects(() => validateCustomCertificate({ certPem: ca.certPem, keyPem: ca.keyPem, lanNames, advertisedHosts: [], hostname: 'box' }), 'CA_CERTIFICATE');
    const encrypted = '-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIBvTBXBgkqhkiG9w0BBQ0wSjApBgkqhkiG9w0BBQwwHAQI\n-----END ENCRYPTED PRIVATE KEY-----\n';
    await rejects(() => validateCustomCertificate({ certPem: old.certPem, keyPem: encrypted, lanNames, advertisedHosts: [], hostname: 'box' }), 'ENCRYPTED_KEY');
    await rejects(() => validateCustomCertificate({ certPem: 'not a cert', keyPem: old.keyPem, lanNames, advertisedHosts: [], hostname: 'box' }), 'INVALID_CERTIFICATE');
  });
});

// ────────────────────────────────────────────────────────────────
// Certificate material for built-in LAN HTTPS (D-110).
//
// A browser on another device only exposes `crypto.subtle` — which pairing
// needs to create its device key — in a secure context, and
// `http://<lan-ip>:<port>` is not one. So once Network exposure is on, the
// server speaks TLS on its network-facing address with a certificate it
// issued itself:
//
//   local CA   ECDSA P-256, 10 years, generated once per install and never
//              re-issued: its fingerprint is what a native client pins and
//              what a user installs to make the browser warning go away.
//              Name-constrained to private addresses, `.local` and
//              `localhost`, so a user who trusts it has not handed out a
//              CA that could vouch for their bank.
//   leaf       ECDSA P-256, 397 days (inside Apple's 825-day ceiling for any
//              TLS server certificate and the 398 days browsers enforce for
//              public ones). Re-issued whenever this machine's LAN addresses
//              change or it nears expiry, always by the same CA.
//
// Generation uses `@peculiar/x509` over Node's WebCrypto; inspection uses
// Node's own `X509Certificate`, which also does key matching and host checks
// for a certificate the admin brings (customCertificate.ts).
// ────────────────────────────────────────────────────────────────

import { X509Certificate as NodeX509Certificate, webcrypto } from 'node:crypto';

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;
import { isIP } from 'node:net';
import * as x509 from '@peculiar/x509';

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0]);

const EC_KEY: webcrypto.EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGNING: webcrypto.EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

export const CA_VALIDITY_DAYS = 3650;
export const LEAF_VALIDITY_DAYS = 397;
/** A leaf this close to expiry is re-issued on the next refresh. */
export const LEAF_RENEW_BEFORE_MS = 30 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** Backdating absorbs a joining device whose clock runs a little behind ours. */
const BACKDATE_MS = 60 * 60_000;

export interface CertificateKeyPair {
  certPem: string;
  keyPem: string;
}

export interface CertificateNames {
  dnsNames: string[];
  ipAddresses: string[];
}

/**
 * What the UI and the pairing APIs say about a certificate. Never contains
 * key material.
 */
export interface CertificateSummary {
  /** SHA-256 of the DER certificate, upper-case hex pairs joined by `:` — the form browsers print. */
  fingerprintSha256: string;
  subject: string;
  issuer: string;
  notBefore: number;
  notAfter: number;
  dnsNames: string[];
  ipAddresses: string[];
  selfIssued: boolean;
}

// ── Name constraints ─────────────────────────────────────────────
//
// `@peculiar/x509` has no high-level class for NameConstraints (RFC 5280
// §4.2.1.10), and the structure is small enough that a hand-rolled DER
// encoder is clearer than a second ASN.1 dependency.

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function tlv(tag: number, value: Uint8Array): Uint8Array {
  const length = derLength(value.length);
  const out = new Uint8Array(1 + length.length + value.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(value, 1 + length.length);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ipv4Bytes(address: string): number[] {
  return address.split('.').map((octet) => Number.parseInt(octet, 10));
}

/** Expands an IPv6 literal (with `::`) to its 16 bytes. */
export function ipv6Bytes(address: string): number[] {
  const [head = '', tail] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...tailGroups];
  return groups.flatMap((group) => {
    const value = Number.parseInt(group || '0', 16);
    return [value >> 8, value & 0xff];
  });
}

function cidrSubtree(cidr: string): Uint8Array {
  const [address = '', prefixText = ''] = cidr.split('/');
  const prefix = Number.parseInt(prefixText, 10);
  const v6 = isIP(address) === 6;
  const bytes = v6 ? ipv6Bytes(address) : ipv4Bytes(address);
  const mask = bytes.map((_, index) => {
    const bits = Math.max(0, Math.min(8, prefix - index * 8));
    return (0xff << (8 - bits)) & 0xff;
  });
  // GeneralSubtree { base iPAddress [7] IMPLICIT OCTET STRING (address ‖ mask) }
  return tlv(0x30, tlv(0x87, Uint8Array.from([...bytes, ...mask])));
}

function dnsSubtree(name: string): Uint8Array {
  // GeneralSubtree { base dNSName [2] IMPLICIT IA5String }
  return tlv(0x30, tlv(0x82, new TextEncoder().encode(name)));
}

/**
 * Where the local CA may vouch. Private IPv4 (RFC 1918), loopback, the CGNAT
 * range Tailscale uses, IPv6 unique-local and loopback, mDNS `.local` names
 * and `localhost`. Everything else is out of its reach even if the user has
 * installed it as a trusted root.
 */
export const CA_PERMITTED_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '100.64.0.0/10',
  'fc00::/7',
  '::1/128',
] as const;
export const CA_PERMITTED_DNS = ['local', 'localhost'] as const;

export function nameConstraintsDer(): Uint8Array {
  const subtrees = [...CA_PERMITTED_DNS.map(dnsSubtree), ...CA_PERMITTED_CIDRS.map(cidrSubtree)];
  // NameConstraints ::= SEQUENCE { permittedSubtrees [0] IMPLICIT GeneralSubtrees }
  return tlv(0x30, tlv(0xa0, concat(subtrees)));
}

const NAME_CONSTRAINTS_OID = '2.5.29.30';

// ── PEM helpers ──────────────────────────────────────────────────

function toPem(label: string, der: ArrayBuffer): string {
  const base64 = Buffer.from(der).toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function fromPem(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) [^-]+-----/g, '').replace(/\s+/g, '');
  const buf = Buffer.from(body, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Splits a PEM bundle into its certificates, leaf first (the order a chain file uses). */
export function splitPemCertificates(bundle: string): string[] {
  return bundle.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)?.map((pem) => `${pem}\n`) ?? [];
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return (await webcrypto.subtle.generateKey(EC_KEY, true, ['sign', 'verify'])) as CryptoKeyPair;
}

async function exportPrivateKeyPem(key: CryptoKey): Promise<string> {
  return toPem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', key));
}

async function importSigningKey(keyPem: string): Promise<CryptoKey> {
  return webcrypto.subtle.importKey('pkcs8', fromPem(keyPem), EC_KEY, false, ['sign']);
}

function randomSerial(): string {
  // 16 random bytes with the top bit cleared: a positive INTEGER, as RFC 5280 requires.
  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  bytes[0] = bytes[0]! & 0x7f;
  return Buffer.from(bytes).toString('hex');
}

// ── Issuance ─────────────────────────────────────────────────────

/** Generates this install's local certificate authority. Called once, on first need. */
export async function generateLocalCa(input: { commonName: string; now?: number }): Promise<CertificateKeyPair> {
  const now = input.now ?? Date.now();
  const keys = await generateKeyPair();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerial(),
    name: [{ CN: [input.commonName] }, { O: ['GeneratorAI'] }],
    notBefore: new Date(now - BACKDATE_MS),
    notAfter: new Date(now + CA_VALIDITY_DAYS * DAY_MS),
    keys,
    signingAlgorithm: SIGNING,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      new x509.Extension(NAME_CONSTRAINTS_OID, true, nameConstraintsDer()),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  return { certPem: `${cert.toString('pem').trim()}\n`, keyPem: await exportPrivateKeyPem(keys.privateKey) };
}

/** Issues a server certificate for `names`, signed by `ca`. */
export async function issueLeafCertificate(input: {
  ca: CertificateKeyPair;
  names: CertificateNames;
  commonName: string;
  now?: number;
}): Promise<CertificateKeyPair> {
  const now = input.now ?? Date.now();
  const caCert = new x509.X509Certificate(input.ca.certPem);
  const caKey = await importSigningKey(input.ca.keyPem);
  const keys = await generateKeyPair();
  const altNames: x509.JsonGeneralName[] = [
    ...input.names.dnsNames.map((value) => ({ type: 'dns' as const, value })),
    ...input.names.ipAddresses.map((value) => ({ type: 'ip' as const, value })),
  ];
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerial(),
    subject: [{ CN: [input.commonName] }],
    issuer: caCert.subjectName,
    notBefore: new Date(now - BACKDATE_MS),
    notAfter: new Date(now + LEAF_VALIDITY_DAYS * DAY_MS),
    publicKey: keys.publicKey,
    signingKey: caKey,
    signingAlgorithm: SIGNING,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension(altNames),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(caCert),
    ],
  });
  return { certPem: `${cert.toString('pem').trim()}\n`, keyPem: await exportPrivateKeyPem(keys.privateKey) };
}

// ── Inspection ───────────────────────────────────────────────────

/** Normalises an IP SAN as Node prints it (`::1` comes back expanded on some versions). */
function normaliseIp(value: string): string {
  if (isIP(value) !== 6) return value;
  const bytes = ipv6Bytes(value);
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i]! << 8) | bytes[i + 1]!).toString(16));
  // Compress the longest run of zero groups, as `URL`/`os` print addresses.
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== '0') {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === '0') j += 1;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  if (bestLength < 2) return groups.join(':');
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLength).join(':')}`;
}

export function parseSubjectAltNames(raw: string | undefined): CertificateNames {
  const dnsNames: string[] = [];
  const ipAddresses: string[] = [];
  for (const entry of (raw ?? '').split(/,\s*/)) {
    const separator = entry.indexOf(':');
    if (separator < 0) continue;
    const kind = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim().replace(/^"|"$/g, '');
    if (kind === 'DNS') dnsNames.push(value.toLowerCase());
    else if (kind === 'IP Address') ipAddresses.push(normaliseIp(value));
  }
  return { dnsNames, ipAddresses };
}

export function describeCertificate(certPem: string): CertificateSummary {
  const cert = new NodeX509Certificate(certPem);
  const names = parseSubjectAltNames(cert.subjectAltName);
  return {
    fingerprintSha256: cert.fingerprint256,
    subject: cert.subject,
    issuer: cert.issuer,
    notBefore: Date.parse(cert.validFrom),
    notAfter: Date.parse(cert.validTo),
    dnsNames: names.dnsNames,
    ipAddresses: names.ipAddresses,
    selfIssued: cert.subject === cert.issuer,
  };
}

/** True when `leafPem` carries a valid signature from `caPem`. */
export function isIssuedBy(leafPem: string, caPem: string): boolean {
  try {
    const leaf = new NodeX509Certificate(leafPem);
    const ca = new NodeX509Certificate(caPem);
    return leaf.checkIssued(ca) && leaf.verify(ca.publicKey);
  } catch {
    return false;
  }
}

/** Same set of names, order ignored. */
export function sameNames(left: CertificateNames, right: CertificateNames): boolean {
  const key = (names: CertificateNames) =>
    [...names.dnsNames.map((n) => `d:${n.toLowerCase()}`), ...names.ipAddresses.map((n) => `i:${normaliseIp(n)}`)]
      .sort()
      .join('|');
  return key(left) === key(right);
}

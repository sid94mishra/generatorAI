// ────────────────────────────────────────────────────────────────
// Which certificate may vouch for which server address (MV-44, MD-199…MD-202).
//
// A server's LAN HTTPS leaf is issued by its own per-install CA (D-110). The
// pairing QR names that CA (`certificateFingerprint`, plus a backup CA so a
// future rotation does not force a re-pair); a typed code learns it from the
// handshake (MD-200). The app then:
//   * talks only `https://` to anything that is not this device itself — the
//     plain-HTTP LAN lane is gone on both ends (MD-201);
//   * anchors every `https://` address inside the CA's name constraints (the
//     private ranges, `.local`, `localhost`) to that CA alone, natively, for
//     fetch, the stream and WebSockets (services/native/trustModule.ts);
//   * leaves public names (a `*.ts.net` certificate, a reverse proxy) to the
//     system trust store, where the local CA could not vouch anyway.
//
// Which names are anchored is the shared endpoint-trust rule (D-125, `endpointTrust` in @generatorai/shared):
// `install-ca` names get the server's CA, `system` names the system store — the same split as the desktop client.
//
// Pure: no React Native imports, unit-tested on node.
// ────────────────────────────────────────────────────────────────

import { endpointTrust } from '@generatorai/shared';

const LOOPBACK_NAMES = new Set(['localhost', '::1']);

/** `[::1]` → `::1`, lower-case, no trailing dot. */
export function bareHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
}

export interface HostPort {
  host: string;
  port: number;
  /** `host:port`, the key the native anchors use. */
  key: string;
  secure: boolean;
}

export function hostPortOf(origin: string): HostPort | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const secure = url.protocol === 'https:';
    const host = bareHost(url.hostname);
    if (!host) return null;
    const port = url.port ? Number(url.port) : secure ? 443 : 80;
    return { host, port, key: `${host}:${port}`, secure };
  } catch {
    return null;
  }
}

function ipv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

export function isLoopbackHost(host: string): boolean {
  const bare = bareHost(host);
  return LOOPBACK_NAMES.has(bare) || bare.endsWith('.localhost') || ipv4(bare)?.[0] === 127;
}

/**
 * Inside the local CA's name constraints (D-110): only these names can carry a certificate that CA issued, so only
 * these are anchored to it. The shared rule decides (D-125), so mobile, desktop and web agree.
 */
export function isPinnableHost(host: string): boolean {
  const bare = bareHost(host);
  return endpointTrust(`https://${bare.includes(':') ? `[${bare}]` : bare}`) === 'install-ca';
}

/** On the LAN (or this device): where iOS Local Network privacy and Android 17's permission apply. */
export function isLocalNetworkHost(host: string): boolean {
  return isPinnableHost(host) && !isLoopbackHost(host);
}

export type EndpointSecurity = 'tls' | 'loopback' | 'plain';

/** `https://` → tls; `http://` to this device → loopback; any other `http://` → plain (refused). */
export function endpointSecurity(origin: string): EndpointSecurity {
  const target = hostPortOf(origin);
  if (!target) return 'plain';
  if (target.secure) return 'tls';
  return isLoopbackHost(target.host) ? 'loopback' : 'plain';
}

/**
 * The endpoints the app may contact, order kept (MD-201): plain HTTP to another device is dropped, and so is plain
 * HTTP to this device whenever the server also offers HTTPS — an offer's `http://127.0.0.1` is the phone itself on a
 * phone, and on a simulator it would skip the pinned TLS the app exists to use.
 */
export function usableEndpoints(origins: readonly string[]): string[] {
  const allowed = origins.filter((origin) => endpointSecurity(origin) !== 'plain');
  return allowed.some((origin) => endpointSecurity(origin) === 'tls')
    ? allowed.filter((origin) => endpointSecurity(origin) === 'tls')
    : allowed;
}

export class InsecureEndpointError extends Error {
  constructor(readonly endpoint: string) {
    super(
      `${endpoint} is not encrypted. This app only connects to a server over HTTPS — update GeneratorAI on your computer, ` +
        'then pair again with a new code.',
    );
    this.name = 'InsecureEndpointError';
  }
}

/** Throws when none of the endpoints may be contacted. */
export function assertSecureEndpoints(origins: readonly string[]): void {
  if (origins.length && usableEndpoints(origins).length === 0) throw new InsecureEndpointError(origins[0]!);
}

/** What the app trusts for one server, stored with its credentials (secure store, `gai.trust.<serverId>`). */
export interface TrustRecord {
  v: 1;
  /** base64url SHA-256 of the CA certificates that may vouch for its LAN addresses; empty = system trust only. */
  fingerprints: string[];
  /** `qr`: from the pairing offer; `certificate`: read from the handshake and confirmed by a person (MD-200). */
  source: 'qr' | 'certificate';
}

const FINGERPRINT = /^[A-Za-z0-9_-]{43}$/;

export function trustRecord(fingerprints: readonly (string | null | undefined)[], source: TrustRecord['source']): TrustRecord {
  return { v: 1, fingerprints: [...new Set(fingerprints.filter((value): value is string => typeof value === 'string' && FINGERPRINT.test(value)))], source };
}

export function parseTrustRecord(raw: string | null): TrustRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TrustRecord>;
    if (value.v !== 1 || !Array.isArray(value.fingerprints) || (value.source !== 'qr' && value.source !== 'certificate')) return null;
    return trustRecord(value.fingerprints, value.source);
  } catch {
    return null;
  }
}

/** The `host:port` keys a record anchors: its `https://` endpoints inside the CA's name constraints. */
export function anchorTargets(record: TrustRecord | null, origins: readonly string[]): string[] {
  if (!record?.fingerprints.length) return [];
  const keys = new Set<string>();
  for (const origin of origins) {
    const target = hostPortOf(origin);
    if (target?.secure && isPinnableHost(target.host)) keys.add(target.key);
  }
  return [...keys];
}

/** Why a paired server cannot be used, when the reason is ours to explain (MD-202); null = an ordinary network failure. */
export type ConnectionProblem = 'insecure-endpoint' | 'identity-changed' | 'local-network-denied';

export function diagnoseConnection(input: {
  endpoints: readonly string[];
  record: TrustRecord | null;
  /** Native: ms since 1970 of the last refused pinned handshake to host:port (0 = never). */
  lastFailure: (host: string, port: number) => number;
  /** Only failures at or after this moment count (the attempt that just failed). */
  since: number;
  /** The server answered with a different identity key (`serverId`) than the one paired with. */
  hostMismatch?: boolean;
}): Extract<ConnectionProblem, 'insecure-endpoint' | 'identity-changed'> | null {
  if (input.endpoints.length && usableEndpoints(input.endpoints).length === 0) return 'insecure-endpoint';
  if (input.hostMismatch) return 'identity-changed';
  for (const key of anchorTargets(input.record, input.endpoints)) {
    const colon = key.lastIndexOf(':');
    if (input.lastFailure(key.slice(0, colon), Number(key.slice(colon + 1))) >= input.since) return 'identity-changed';
  }
  return null;
}

/** First 8 bytes in upper-case pairs, as browsers print a SHA-256 (and the desktop's pairing panel shows it). */
export function shortFingerprint(base64url: string): string {
  const binary = globalThis.atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  const pairs = Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase());
  return pairs.length > 8 ? `${pairs.slice(0, 8).join(' ')} …` : pairs.join(' ');
}

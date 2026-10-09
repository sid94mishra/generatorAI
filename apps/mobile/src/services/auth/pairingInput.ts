// Pairing input (MPairing, MB-39, MP-40, MD-34, MD-35): what a scanned QR or a `pair` link pre-fills, turning the code
// + server address into the consent the person confirms, and the address reachability line. Wraps
// `@generatorai/client-runtime` so screens never import it (MD-14). Nothing here pairs: `completePairing` does,
// after the person confirms.
//
// Trust (MV-44, MD-199, MD-200): a QR names the server's CA (and a backup), so the proposal pins it as given. A typed
// code has no such anchor: the CA is read from the TLS handshake (no request is sent), anchored only for the preview
// call, and the person compares the certificate with the one their computer shows before pairing.
import { PairingCodeError, parsePairingCode, resolveShortPairingCode, type PairingConsent } from '@generatorai/client-runtime';
import { isPairingCode, normalizePairingCode } from '@generatorai/shared';

import { NativeTrust } from '../native/trustModule';
import { endpointSecurity, hostPortOf, isPinnableHost, trustRecord, usableEndpoints, type TrustRecord } from '../transport/trust';

export type { PairingConsent };

export interface PairingPrefill {
  /** The 12-character code (canonical, no dashes). */
  code: string;
  /** The server origin when the input carried one (a QR / offer link). */
  address: string | null;
  /** The decoded offer, used as-is when the code and address are left unchanged. */
  consent: PairingConsent | null;
}

/** What the person is asked to confirm: the consent, the CA(s) the server will be anchored to, and how it was learned. */
export interface PairingProposal {
  consent: PairingConsent;
  trust: TrustRecord;
  /**
   * A typed code: the leaf the server presented (base64url SHA-256), shown so the person can compare it with the
   * certificate on their computer. Null for a QR, which names the CA itself.
   */
  certificate: string | null;
}

/** A scanned QR, a `generatorai://pair?code=` link or a typed code → what to pre-fill; null when it is not ours. */
export function prefillFrom(input: string): PairingPrefill | null {
  const raw = input.trim();
  if (!raw) return null;
  const bare = raw.startsWith('generatorai://pair') ? (new URLSearchParams(raw.slice(raw.indexOf('?') + 1)).get('code') ?? '') : raw;
  if (isPairingCode(bare)) return { code: normalizePairingCode(bare), address: null, consent: null };
  try {
    const consent = parsePairingCode(raw);
    return { code: normalizePairingCode(consent.pairingGrant), address: consent.endpoint, consent };
  } catch {
    return null;
  }
}

export type ConsentError = { field: 'code' | 'address' | 'form'; message: string };

/** "https://host:3100" from what was typed ("192.168.1.24:3100" gets https://); null when it cannot be an origin. */
export function normalizeAddress(input: string): string | null {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw || /^https?:?$/i.test(raw)) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export const PLAIN_HTTP_MESSAGE = 'GeneratorAI connects to other devices only over HTTPS. Use the https:// address your computer shows.';
const OLD_SERVER_MESSAGE =
  'This code is for an unencrypted connection, which this app no longer uses. Update GeneratorAI on your computer, then show a new code.';

const fieldError = (field: ConsentError['field'], message: string): Error & { field: ConsentError['field'] } =>
  Object.assign(new Error(message), { field });

/** The QR's own anchors: its CA and the backup CA (absent for a server that uses its own certificate → system trust). */
function offerTrust(consent: PairingConsent): TrustRecord {
  return trustRecord([consent.offer?.certificateFingerprint, consent.offer?.backupCertificateFingerprint], 'qr');
}

/** The native anchor set used while a typed code is previewed (never a server id: those are base64url host keys). */
const PREVIEW_ANCHORS = 'pairing-preview';

/** Code + address → the proposal to show, asking the server what the code grants (`/auth/pair/preview`). */
export async function consentFor(code: string, address: string, prefilled: PairingConsent | null): Promise<PairingProposal> {
  const canonical = normalizePairingCode(code);
  const origin = normalizeAddress(address);
  if (prefilled && normalizePairingCode(prefilled.pairingGrant) === canonical && (!origin || origin === prefilled.endpoint)) {
    if (!usableEndpoints(prefilled.endpoints.map((endpoint) => endpoint.origin)).length) throw fieldError('form', OLD_SERVER_MESSAGE);
    return { consent: prefilled, trust: offerTrust(prefilled), certificate: null };
  }
  if (!origin) throw fieldError('address', 'Enter the server address, like https://192.168.1.24:3100');
  if (endpointSecurity(origin) === 'plain') throw fieldError('address', PLAIN_HTTP_MESSAGE);
  const target = hostPortOf(origin)!;

  // A LAN https:// address: read the CA from the handshake and anchor it for the preview only.
  let trust = trustRecord([], 'certificate');
  let certificate: string | null = null;
  const pinned = target.secure && isPinnableHost(target.host);
  if (pinned) {
    let chain;
    try {
      chain = await NativeTrust.inspect(target.host, target.port);
    } catch {
      throw fieldError('address', `Could not reach ${origin} over HTTPS. Check the address and that this device is on the same network.`);
    }
    trust = trustRecord([chain.root], 'certificate');
    certificate = chain.leaf;
    NativeTrust.setAnchors(PREVIEW_ANCHORS, [target.key], trust.fingerprints);
  }
  try {
    const consent = await resolveShortPairingCode(origin, canonical);
    return { consent, trust, certificate };
  } catch (e) {
    if (e instanceof PairingCodeError && e.code === 'UNREACHABLE') throw fieldError('address', e.message);
    throw fieldError('code', e instanceof Error ? e.message : 'That code is not valid.');
  } finally {
    if (pinned) NativeTrust.clearAnchors(PREVIEW_ANCHORS);
  }
}

export type Reachability =
  | { kind: 'checking' }
  | { kind: 'reachable'; serverName: string | null }
  | { kind: 'unreachable' }
  /** An `http://` address to another device: refused before any request (MD-201). */
  | { kind: 'insecure' };

/** Pre-auth reachability of the typed origin (never sends a credential; to a LAN address, not even a request). */
export async function probeAddress(address: string, signal?: AbortSignal): Promise<Reachability> {
  const origin = normalizeAddress(address);
  if (!origin) return { kind: 'unreachable' };
  if (endpointSecurity(origin) === 'plain') return { kind: 'insecure' };
  const target = hostPortOf(origin)!;
  try {
    if (target.secure && isPinnableHost(target.host)) {
      // Its CA is not trusted yet; the handshake alone shows the server answers HTTPS there.
      await NativeTrust.inspect(target.host, target.port);
      return { kind: 'reachable', serverName: null };
    }
    const res = await fetch(`${origin}/api/auth/server-info`, { method: 'GET', ...(signal ? { signal } : {}) });
    if (!res.ok) return { kind: 'unreachable' };
    const body = (await res.json().catch(() => null)) as { serverName?: unknown } | null;
    return { kind: 'reachable', serverName: typeof body?.serverName === 'string' ? body.serverName : null };
  } catch {
    return { kind: 'unreachable' };
  }
}

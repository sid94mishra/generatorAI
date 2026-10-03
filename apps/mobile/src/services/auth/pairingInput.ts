// Pairing input (MPairing, MB-39, MP-40, MD-34, MD-35): what a scanned QR or a `pair` link pre-fills, turning the code
// + server address into the consent the person confirms, and the address reachability line. Wraps
// `@generatorai/client-runtime` so screens never import it (MD-14). Nothing here pairs: `completePairing` does,
// after the person confirms.
import { PairingCodeError, parsePairingCode, resolveShortPairingCode, type PairingConsent } from '@generatorai/client-runtime';
import { isPairingCode, normalizePairingCode } from '@generatorai/shared';

export type { PairingConsent };

export interface PairingPrefill {
  /** The 12-character code (canonical, no dashes). */
  code: string;
  /** The server origin when the input carried one (a QR / offer link). */
  address: string | null;
  /** The decoded offer, used as-is when the code and address are left unchanged. */
  consent: PairingConsent | null;
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

/** "http://host:3100" from what was typed ("192.168.1.24:3100" gets http://); null when it cannot be an origin. */
export function normalizeAddress(input: string): string | null {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw || /^https?:?$/i.test(raw)) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Code + address → the consent to show, asking the server what the code grants (`/auth/pair/preview`). */
export async function consentFor(code: string, address: string, prefilled: PairingConsent | null): Promise<PairingConsent> {
  const canonical = normalizePairingCode(code);
  const origin = normalizeAddress(address);
  if (prefilled && normalizePairingCode(prefilled.pairingGrant) === canonical && (!origin || origin === prefilled.endpoint)) return prefilled;
  if (!origin) throw Object.assign(new Error('Enter the server address, like http://192.168.1.24:3100'), { field: 'address' as const });
  try {
    return await resolveShortPairingCode(origin, canonical);
  } catch (e) {
    if (e instanceof PairingCodeError && e.code === 'UNREACHABLE') throw Object.assign(new Error(e.message), { field: 'address' as const });
    throw Object.assign(new Error(e instanceof Error ? e.message : 'That code is not valid.'), { field: 'code' as const });
  }
}

export type Reachability = { kind: 'checking' } | { kind: 'reachable'; serverName: string | null } | { kind: 'unreachable' };

/** Pre-auth `GET /api/auth/server-info` on the typed origin (never sends a credential). */
export async function probeAddress(address: string, signal?: AbortSignal): Promise<Reachability> {
  const origin = normalizeAddress(address);
  if (!origin) return { kind: 'unreachable' };
  try {
    const res = await fetch(`${origin}/api/auth/server-info`, { method: 'GET', ...(signal ? { signal } : {}) });
    if (!res.ok) return { kind: 'unreachable' };
    const body = (await res.json().catch(() => null)) as { serverName?: unknown } | null;
    return { kind: 'reachable', serverName: typeof body?.serverName === 'string' ? body.serverName : null };
  } catch {
    return { kind: 'unreachable' };
  }
}

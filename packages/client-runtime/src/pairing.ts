// ────────────────────────────────────────────────────────────────
// Pairing-code import.
//
// The pairing code is entirely attacker-controllable (a user can be tricked
// into scanning a hostile QR), so decoding is strict-schema, bounded, and the
// caller MUST show the resulting `PairingConsent` to the user before calling
// `completePairing`.
// ────────────────────────────────────────────────────────────────

import {
  decodePairingOffer,
  pairingEndpoints,
  type PairingEndpoint,
  type PairingOffer,
} from '@generatorai/relay-protocol';
import { isPairingCode, normalizePairingCode } from '@generatorai/shared';

export interface PairingConsent {
  serverName: string;
  endpoint: string;
  endpoints: PairingEndpoint[];
  /** Pin this: it is how the client detects a substituted host later. */
  serverId: string;
  /** Short, human-comparable form of `serverId` for the consent screen. */
  fingerprint: string;
  requestedScopes: string[];
  transportCapabilities: string[];
  relayOffered: boolean;
  expiresAt: number;
  /**
   * The single-use grant to redeem. Held directly rather than read off
   * `offer`, because a consent can also originate from a short code typed by
   * hand, where no offer blob exists.
   */
  pairingGrant: string;
  /** Present only when the consent came from a decoded QR/offer payload. */
  offer?: PairingOffer;
}

export class PairingCodeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'PairingCodeError';
  }
}

/**
 * Parses a pairing code or `generatorai://pair?code=…` URL.
 * Returns everything the consent screen needs — and nothing the caller could
 * accidentally act on without showing the user first.
 */
export function parsePairingCode(input: string): PairingConsent {
  const code = extractCode(input.trim());
  const result = decodePairingOffer(code);
  if (!result.ok || !result.offer) {
    throw new PairingCodeError(result.error ?? 'This pairing code is not valid.', 'INVALID_OFFER');
  }
  const offer = result.offer;
  const endpoints = pairingEndpoints(offer);
  if (offer.pairingExpiresAt <= Date.now()) {
    throw new PairingCodeError('This pairing code has expired. Generate a new one.', 'EXPIRED');
  }
  return {
    serverName: offer.serverName,
    endpoint: endpoints[0]!.origin,
    endpoints,
    serverId: offer.serverId,
    fingerprint: formatFingerprint(offer.serverId),
    requestedScopes: [...offer.requestedScopes],
    transportCapabilities: [...offer.transportCapabilities],
    relayOffered: Boolean(offer.relay),
    expiresAt: offer.pairingExpiresAt,
    pairingGrant: offer.pairingGrant,
    offer,
  };
}

/**
 * Turns a SHORT typed code (`4H7K-2M9P-XQ3T`) into the same consent screen the
 * offer blob produces, by asking the host what the code grants.
 *
 * A short code deliberately carries no endpoint, so the caller must supply the
 * origin it already knows it is talking to. That is why this cannot be folded
 * into `parsePairingCode`, which is offline and synchronous by design.
 *
 * This exists here, in the shared runtime, because the short-code path was
 * implemented only in the web app (`apps/web/src/platform/authRuntime.ts`)
 * while the CLI and the mobile app went through `parsePairingCode` alone — so
 * both rejected the very code their own UI told the user to type. The CLI's
 * documented example is `generatorai device pair XXXX-XXXX-XXXX`, and the web
 * "Pair a device" panel prints the short code under "2. Enter this code"; both
 * answered "that does not look like a pairing code".
 *
 * `/api/auth/pair/preview` is deliberately pre-auth: the device asking has no
 * session yet, which is the whole reason it is asking.
 */
export async function resolveShortPairingCode(
  origin: string,
  shortCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PairingConsent> {
  const pairingGrant = normalizePairingCode(shortCode.trim());
  let response: Response;
  try {
    response = await fetchImpl(`${origin.replace(/\/$/, '')}/api/auth/pair/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingToken: pairingGrant }),
    });
  } catch {
    throw new PairingCodeError(
      `Could not reach ${origin}. Check that the server is running and that this device can reach it.`,
      'UNREACHABLE',
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      body && typeof body === 'object' && 'error' in body
        ? (body as { error?: { code?: string; message?: string } }).error
        : undefined;
    throw new PairingCodeError(
      error?.message ?? 'This pairing code is not valid.',
      error?.code ?? 'INVALID_GRANT',
    );
  }

  const preview = body as {
    serverId: string;
    serverName: string;
    requestedScopes: string[];
    expiresAt: number;
    endpoints?: Array<{ origin: string; reachability: string; priority: number }>;
  };

  // The origin that just answered is the one to pin; the host's advertised
  // list is kept as fallbacks but never ahead of the demonstrably reachable one.
  const advertised = (preview.endpoints ?? []).filter((e) => e.origin !== origin);
  return {
    serverName: preview.serverName,
    endpoint: origin,
    endpoints: [
      { origin, reachability: 'lan', priority: 0 },
      ...advertised.map((e, index) => ({
        origin: e.origin,
        reachability: e.reachability as PairingEndpoint['reachability'],
        priority: index + 1,
      })),
    ],
    serverId: preview.serverId,
    fingerprint: formatFingerprint(preview.serverId),
    requestedScopes: preview.requestedScopes,
    transportCapabilities: ['lan'],
    relayOffered: false,
    expiresAt: preview.expiresAt,
    pairingGrant,
  };
}

/**
 * One entry point for "the user gave us a pairing code", whichever shape it
 * is in: a short typed code, a full offer blob, or a `generatorai://pair`
 * link. `origin` is only consulted for the short form, which carries no
 * endpoint of its own.
 */
export async function resolvePairingInput(
  input: string,
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PairingConsent> {
  const trimmed = input.trim();
  return isPairingCode(trimmed)
    ? resolveShortPairingCode(origin, trimmed, fetchImpl)
    : parsePairingCode(trimmed);
}

function extractCode(input: string): string {
  if (input.startsWith('generatorai://pair')) {
    // `new URL` on a custom scheme keeps the query intact.
    const query = input.slice(input.indexOf('?') + 1);
    const params = new URLSearchParams(query);
    const code = params.get('code');
    if (!code) throw new PairingCodeError('Pairing link is missing its code.', 'MISSING_CODE');
    return code;
  }
  return input;
}

/**
 * Renders the 43-char host id as grouped 4-char blocks so a human can compare
 * it against the screen showing the QR. Only the first 16 characters are
 * shown — enough entropy to be unforgeable in practice, short enough to read.
 */
export function formatFingerprint(serverId: string): string {
  return (serverId.slice(0, 16).match(/.{1,4}/g) ?? []).join('-').toUpperCase();
}

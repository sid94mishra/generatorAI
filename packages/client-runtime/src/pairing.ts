// ────────────────────────────────────────────────────────────────
// Pairing-code import.
//
// The pairing code is entirely attacker-controllable (a user can be tricked
// into scanning a hostile QR), so decoding is strict-schema, bounded, and the
// caller MUST show the resulting `PairingConsent` to the user before calling
// `completePairing`.
// ────────────────────────────────────────────────────────────────

import { decodePairingOffer, type PairingOffer } from '@generatorai/relay-protocol';

export interface PairingConsent {
  serverName: string;
  endpoint: string;
  /** Pin this: it is how the client detects a substituted host later. */
  serverId: string;
  /** Short, human-comparable form of `serverId` for the consent screen. */
  fingerprint: string;
  requestedScopes: string[];
  transportCapabilities: string[];
  relayOffered: boolean;
  expiresAt: number;
  offer: PairingOffer;
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
  if (offer.pairingExpiresAt <= Date.now()) {
    throw new PairingCodeError('This pairing code has expired. Generate a new one.', 'EXPIRED');
  }
  return {
    serverName: offer.serverName,
    endpoint: offer.endpoint,
    serverId: offer.serverId,
    fingerprint: formatFingerprint(offer.serverId),
    requestedScopes: [...offer.requestedScopes],
    transportCapabilities: [...offer.transportCapabilities],
    relayOffered: Boolean(offer.relay),
    expiresAt: offer.pairingExpiresAt,
    offer,
  };
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

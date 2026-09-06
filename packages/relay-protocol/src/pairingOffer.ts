// ────────────────────────────────────────────────────────────────
// Pairing offer — the payload behind the QR code / `generatorai://pair` link.
//
// This is the ONLY out-of-band channel that establishes trust between a client
// and a GeneratorAI host, so it is validated with an exact, closed schema:
//   * canonical base64url key encoding (no aliasing → one identity per key)
//   * bounded lengths on every string (QR payloads are attacker-controlled)
//   * a pairing grant TTL that can never exceed 10 minutes
//   * relay material only when the offer actually advertises relay transport
//
// Trust comes from pinning `serverPublicKey`/`serverId` here — NOT from the
// user clicking through a TLS warning.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { decodeCanonicalBase64Url, fromBase64Url, toBase64Url, utf8 } from './bytes.js';
import { hostIdFromPublicKey } from './e2ee.js';

export const PAIRING_OFFER_VERSION = 2;
export const PAIRING_CODE_MAX_CHARACTERS = 8 * 1024;
export const PAIRING_ENDPOINT_MAX_CHARACTERS = 2048;
export const MAX_PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRING_URL_SCHEME = 'generatorai://pair';

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_32BYTE = /^[A-Za-z0-9_-]{43}$/;

const ScopeString = z.string().min(1).max(64).regex(/^[a-z]+:[a-z_]+$/);

export const PairingEndpointSchema = z
  .object({
    origin: z.string().min(1).max(PAIRING_ENDPOINT_MAX_CHARACTERS).refine(isAllowedEndpoint, 'Unsupported endpoint'),
    reachability: z.enum(['loopback', 'lan', 'private-network', 'public']),
    priority: z.number().int().min(0).max(10_000),
  })
  .strict();
export type PairingEndpoint = z.infer<typeof PairingEndpointSchema>;

function isCanonicalKey(value: string): boolean {
  return decodeCanonicalBase64Url(value, 32) !== null;
}

function isAllowedEndpoint(value: string): boolean {
  if (value.length > PAIRING_ENDPOINT_MAX_CHARACTERS) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Plain http is only accepted for loopback/LAN/.local hosts, where the
    // network hop is assumed to be the user's own. There is NO message-level
    // encryption above it today: the E2EE layer in `e2ee.ts` is not wired
    // into any transport, so an http endpoint is protected by the server's
    // request authentication (DPoP-bound tokens) and nothing else. Anything
    // reachable from a public network must be https.
    if (parsed.protocol === 'http:') {
      const host = parsed.hostname;
      const isPrivate =
        host === 'localhost' ||
        /^127\./.test(host) ||
        host === '::1' ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /\.local$/.test(host);
      if (!isPrivate) return false;
    }
    return value === parsed.origin || value === parsed.origin + parsed.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}

function isCanonicalHttpsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && value === parsed.origin;
  } catch {
    return false;
  }
}

export function createPairingOfferSchema(now: () => number = () => Date.now()) {
  const relaySchema = z
    .object({
      v: z.literal(1),
      directorUrl: z.string().min(1).max(2048).refine(isCanonicalHttpsOrigin, 'Expected a canonical HTTPS origin'),
      cellUrl: z.string().min(1).max(2048).refine(isCanonicalHttpsOrigin, 'Expected a canonical HTTPS origin'),
      assignmentEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      relayHostId: z.string().regex(BASE64URL_43),
      inviteToken: z.string().regex(BASE64URL_43),
      inviteExpiresAt: z
        .number()
        .int()
        .refine((value) => {
          const current = now();
          return value > current && value <= current + MAX_PAIRING_TTL_MS;
        }, 'Relay invite must expire within 10 minutes'),
      e2eeFraming: z.literal(1),
    })
    .strict();

  return z
    .object({
      v: z.union([z.literal(1), z.literal(PAIRING_OFFER_VERSION)]),
      /** Absolute base URL of the GeneratorAI API for LAN/loopback transport. */
      endpoint: z.string().min(1).max(PAIRING_ENDPOINT_MAX_CHARACTERS).refine(isAllowedEndpoint, 'Unsupported endpoint'),
      /** Ordered direct routes. Version 1 offers normalize to the primary endpoint. */
      endpoints: z.array(PairingEndpointSchema).min(1).max(16).optional(),
      /** Canonical host identity, derived from `serverPublicKey`. */
      serverId: z.string().regex(BASE64URL_43),
      /** Host's long-term X25519 public key (base64url, 32 bytes). */
      serverPublicKey: z.string().regex(BASE64URL_32BYTE).refine(isCanonicalKey, 'Non-canonical key'),
      /** Fingerprint of a self-signed TLS certificate, when one is in use. */
      certificateFingerprint: z.string().max(128).optional(),
      /** Single-use pairing grant. */
      // Lower bound is 12 to admit the human-typeable pairing code
      // (`@generatorai/shared` -> PAIRING_CODE_LENGTH). The upper bound still
      // accommodates the legacy 43-char opaque grants embedded in offers
      // minted by older servers.
      pairingGrant: z.string().min(12).max(256),
      pairingExpiresAt: z
        .number()
        .int()
        .refine((value) => {
          const current = now();
          return value > current && value <= current + MAX_PAIRING_TTL_MS;
        }, 'Pairing grant must expire within 10 minutes'),
      requestedScopes: z.array(ScopeString).min(1).max(40),
      transportCapabilities: z.array(z.enum(['loopback', 'lan', 'ssh', 'relay'])).min(1).max(4),
      serverName: z.string().min(1).max(120),
      relay: relaySchema.optional(),
    })
    .strict()
    .superRefine((offer, ctx) => {
      if (offer.v === PAIRING_OFFER_VERSION) {
        if (!offer.endpoints) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['endpoints'],
            message: 'Version 2 pairing offers require endpoints',
          });
        } else if (offer.endpoints[0]?.origin !== offer.endpoint) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['endpoints', 0, 'origin'],
            message: 'Primary endpoint must be the first endpoint candidate',
          });
        }
      } else if (offer.endpoints !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endpoints'],
          message: 'Version 1 pairing offers cannot contain endpoints',
        });
      }
      const key = fromBase64Url(offer.serverPublicKey);
      if (!key || hostIdFromPublicKey(key) !== offer.serverId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serverId'],
          message: 'serverId must be derived from serverPublicKey',
        });
      }
      if (offer.relay) {
        if (!offer.transportCapabilities.includes('relay')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['relay'],
            message: 'Relay material present but relay transport is not advertised',
          });
        }
        if (offer.relay.relayHostId !== offer.serverId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['relay', 'relayHostId'],
            message: 'relayHostId must equal serverId',
          });
        }
      }
    });
}

export const PairingOfferSchema = createPairingOfferSchema();
export type PairingOffer = z.infer<typeof PairingOfferSchema>;

export function pairingEndpoints(offer: PairingOffer): PairingEndpoint[] {
  return offer.endpoints
    ? [...offer.endpoints].sort((left, right) => left.priority - right.priority)
    : [
        {
          origin: offer.endpoint,
          reachability: offer.transportCapabilities.includes('loopback') ? 'loopback' : 'lan',
          priority: 0,
        },
      ];
}

/** Encodes an offer as the compact base64url payload embedded in the QR code. */
export function encodePairingOffer(offer: PairingOffer): string {
  const json = JSON.stringify(offer);
  const encoded = toBase64Url(utf8(json));
  if (encoded.length > PAIRING_CODE_MAX_CHARACTERS) {
    throw new Error('Pairing offer exceeds the maximum payload size');
  }
  return encoded;
}

export function pairingOfferUrl(offer: PairingOffer): string {
  return `${PAIRING_URL_SCHEME}?code=${encodePairingOffer(offer)}`;
}

export interface PairingDecodeResult {
  ok: boolean;
  offer?: PairingOffer;
  error?: string;
}

/** Decodes + strictly validates a pairing code. Never throws. */
export function decodePairingOffer(
  code: string,
  now: () => number = () => Date.now(),
): PairingDecodeResult {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > PAIRING_CODE_MAX_CHARACTERS + 1024) {
    return { ok: false, error: 'Pairing code is empty or too large' };
  }
  // Accept both a raw payload and a full `generatorai://pair?code=…` URL.
  let payload = trimmed;
  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      const value = url.searchParams.get('code');
      if (!value) return { ok: false, error: 'Pairing URL has no code parameter' };
      payload = value;
    } catch {
      return { ok: false, error: 'Pairing URL is malformed' };
    }
  }
  const bytes = fromBase64Url(payload);
  if (!bytes) return { ok: false, error: 'Pairing code is not valid base64url' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, error: 'Pairing code does not contain valid JSON' };
  }
  const result = createPairingOfferSchema(now).safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'Pairing offer is invalid' };
  }
  return { ok: true, offer: result.data };
}

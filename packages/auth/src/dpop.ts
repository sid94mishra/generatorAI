// ────────────────────────────────────────────────────────────────
// DPoP — OAuth 2.0 Demonstrating Proof of Possession (RFC 9449)
//
// Binds an access token to the client's private key so a stolen token cannot
// be replayed by a different holder. Verification checks, in order:
//
//   1. Exactly one DPoP header (multiples are ambiguous → reject).
//   2. Well-formed compact JWS with `typ = dpop+jwt`.
//   3. An asymmetric, allow-listed `alg` (`none` / HS* rejected).
//   4. Signature verifies against the embedded public JWK.
//   5. No private JWK members are present.
//   6. `htm` equals the HTTP method.
//   7. `htu` equals the canonical request URI (scheme+authority+path, no
//      query/fragment).
//   8. `iat` is inside the acceptance window.
//   9. `jti` has not been seen before.
//  10. A server nonce matches, when one is required.
//  11. `ath` equals the base64url SHA-256 of the presented access token.
//  12. The proof key thumbprint equals the token's `cnf.jkt`.
// ────────────────────────────────────────────────────────────────

import {
  JoseError,
  decodeJws,
  importPublicJwk,
  jwkThumbprint,
  sha256Base64Url,
  verifyBytes,
  type JwsAlg,
} from './jose.js';
import type { INonceStore, IReplayStore } from './ports.js';

export const DPOP_HEADER = 'dpop';
export const DPOP_NONCE_HEADER = 'dpop-nonce';
/** RFC 9449 §7.1 — the challenge returned when a fresh nonce is required. */
export const DPOP_NONCE_ERROR = 'use_dpop_nonce';

export type DpopFailureCode =
  | 'MISSING_PROOF'
  | 'MULTIPLE_PROOFS'
  | 'MALFORMED'
  | 'BAD_TYP'
  | 'BAD_ALG'
  | 'BAD_JWK'
  | 'BAD_SIGNATURE'
  | 'HTM_MISMATCH'
  | 'HTU_MISMATCH'
  | 'IAT_OUT_OF_WINDOW'
  | 'REPLAYED'
  | 'NONCE_REQUIRED'
  | 'NONCE_INVALID'
  | 'ATH_MISMATCH'
  | 'JKT_MISMATCH';

export class DpopError extends Error {
  constructor(message: string, readonly code: DpopFailureCode) {
    super(message);
    this.name = 'DpopError';
  }
}

export interface DpopVerificationInput {
  /** Raw header value(s). Arrays with >1 entry are rejected. */
  proof: string | string[] | undefined;
  method: string;
  /** Full request URL; query + fragment are stripped before comparison. */
  url: string;
  /** The access token being presented, when this is a protected-resource call. */
  accessToken?: string | undefined;
  /** Expected `cnf.jkt` from the access token. */
  expectedThumbprint?: string | undefined;
  /** Require a server-issued nonce (used when clock skew was detected). */
  requireNonce?: boolean;
  now?: number;
}

export interface DpopVerificationResult {
  thumbprint: string;
  jwk: Record<string, unknown>;
  jti: string;
  iat: number;
  alg: JwsAlg;
}

export interface DpopVerifierOptions {
  replayStore: IReplayStore;
  nonceStore: INonceStore;
  /** Accepted `iat` skew, in ms, in both directions. Default 60s. */
  acceptanceWindowMs?: number;
}

export class DpopVerifier {
  private readonly windowMs: number;

  constructor(private readonly options: DpopVerifierOptions) {
    this.windowMs = options.acceptanceWindowMs ?? 60_000;
  }

  /** Issues a nonce for the `DPoP-Nonce` response header. */
  async issueNonce(now = Date.now()): Promise<string> {
    return this.options.nonceStore.issue(now + 5 * 60_000);
  }

  async verify(input: DpopVerificationInput): Promise<DpopVerificationResult> {
    const now = input.now ?? Date.now();

    // 1 — exactly one proof.
    if (Array.isArray(input.proof)) {
      if (input.proof.length !== 1) {
        throw new DpopError('Exactly one DPoP header is required', 'MULTIPLE_PROOFS');
      }
      input = { ...input, proof: input.proof[0] };
    }
    const proof = input.proof;
    if (typeof proof !== 'string' || proof.length === 0) {
      throw new DpopError('Missing DPoP proof', 'MISSING_PROOF');
    }
    // A proof is a compact JWS; anything wildly oversized is a DoS attempt.
    if (proof.length > 8192) {
      throw new DpopError('DPoP proof is too large', 'MALFORMED');
    }

    // 2 — structure.
    let decoded;
    try {
      decoded = decodeJws(proof);
    } catch (err) {
      throw new DpopError(
        err instanceof JoseError ? err.message : 'Malformed DPoP proof',
        'MALFORMED',
      );
    }
    if (decoded.header['typ'] !== 'dpop+jwt') {
      throw new DpopError('DPoP proof must set typ="dpop+jwt"', 'BAD_TYP');
    }

    // 3 — algorithm allow-list. `none` and every HMAC variant are rejected
    //     because the proof key is public: a symmetric alg would let anyone
    //     who can read the JWK forge a proof.
    const alg = decoded.header['alg'];
    if (alg !== 'EdDSA' && alg !== 'ES256') {
      throw new DpopError(`Unsupported DPoP alg "${String(alg)}"`, 'BAD_ALG');
    }

    // 4/5 — key import (rejects private members) + signature.
    let imported;
    try {
      imported = importPublicJwk(decoded.header['jwk']);
    } catch (err) {
      throw new DpopError(
        err instanceof JoseError ? err.message : 'Invalid DPoP JWK',
        err instanceof JoseError && err.code === 'PRIVATE_JWK' ? 'BAD_JWK' : 'BAD_JWK',
      );
    }
    if (imported.alg !== alg) {
      throw new DpopError('DPoP alg does not match the embedded JWK type', 'BAD_ALG');
    }
    const signatureOk = verifyBytes(
      imported.alg,
      imported.key,
      Buffer.from(decoded.signingInput, 'utf8'),
      decoded.signature,
    );
    if (!signatureOk) {
      throw new DpopError('DPoP proof signature is invalid', 'BAD_SIGNATURE');
    }

    const payload = decoded.payload;

    // 6 — method binding.
    if (typeof payload['htm'] !== 'string' || payload['htm'] !== input.method.toUpperCase()) {
      throw new DpopError('DPoP htm does not match the request method', 'HTM_MISMATCH');
    }

    // 7 — URI binding.
    const expectedHtu = canonicalHtu(input.url);
    if (typeof payload['htu'] !== 'string' || canonicalHtu(payload['htu']) !== expectedHtu) {
      throw new DpopError('DPoP htu does not match the request URI', 'HTU_MISMATCH');
    }

    // 8 — freshness.
    const iat = payload['iat'];
    if (typeof iat !== 'number' || !Number.isFinite(iat)) {
      throw new DpopError('DPoP iat is missing or malformed', 'IAT_OUT_OF_WINDOW');
    }
    const iatMs = iat * 1000;
    if (Math.abs(now - iatMs) > this.windowMs) {
      throw new DpopError('DPoP proof iat is outside the acceptance window', 'IAT_OUT_OF_WINDOW');
    }

    // 10 — nonce (checked before consuming the jti so a nonce challenge does
    //      not burn the client's proof id).
    const nonce = payload['nonce'];
    if (input.requireNonce) {
      if (typeof nonce !== 'string' || nonce.length === 0) {
        throw new DpopError('A server-issued DPoP nonce is required', 'NONCE_REQUIRED');
      }
      const nonceOk = await this.options.nonceStore.verify(nonce, now);
      if (!nonceOk) {
        throw new DpopError('DPoP nonce is unknown or expired', 'NONCE_INVALID');
      }
    } else if (typeof nonce === 'string' && nonce.length > 0) {
      // A client may volunteer a nonce; if it does, it must be valid.
      const nonceOk = await this.options.nonceStore.verify(nonce, now);
      if (!nonceOk) {
        throw new DpopError('DPoP nonce is unknown or expired', 'NONCE_INVALID');
      }
    }

    // 9 — replay. Hash the jti so the store never holds attacker-chosen
    //     unbounded strings, and expire it with the acceptance window.
    const jti = payload['jti'];
    if (typeof jti !== 'string' || jti.length === 0 || jti.length > 256) {
      throw new DpopError('DPoP jti is missing or malformed', 'MALFORMED');
    }
    const fresh = await this.options.replayStore.register(
      sha256Base64Url(jti),
      now + this.windowMs * 2,
    );
    if (!fresh) {
      throw new DpopError('DPoP proof has already been used', 'REPLAYED');
    }

    // 11 — access-token binding.
    if (input.accessToken) {
      const expectedAth = sha256Base64Url(input.accessToken);
      if (typeof payload['ath'] !== 'string' || payload['ath'] !== expectedAth) {
        throw new DpopError('DPoP ath does not match the presented access token', 'ATH_MISMATCH');
      }
    }

    // 12 — the proof key must be the key the token was issued to.
    const thumbprint = jwkThumbprint(imported.jwk);
    if (input.expectedThumbprint && input.expectedThumbprint !== thumbprint) {
      throw new DpopError('DPoP key does not match the access token cnf.jkt', 'JKT_MISMATCH');
    }

    return {
      thumbprint,
      jwk: imported.jwk as unknown as Record<string, unknown>,
      jti,
      iat,
      alg: imported.alg,
    };
  }
}

/**
 * Canonical `htu`: scheme + authority + path. Query and fragment are removed
 * per RFC 9449 §4.3; the default port is dropped so `https://h:443/x` and
 * `https://h/x` compare equal.
 */
export function canonicalHtu(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }
  // Normalize a trailing-slash-only path so `/api` and `/api/` do not diverge
  // for the root case only; deeper paths stay byte-exact.
  return parsed.toString();
}

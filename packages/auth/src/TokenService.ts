// ────────────────────────────────────────────────────────────────
// TokenService — mints and verifies every credential class.
//
//   access token   5–15 min, DPoP-bound (`cnf.jkt`), carries scopes
//   resume/refresh long-lived opaque secret, hashed at rest, rotatable
//   stream ticket  30 s, single-use, scope-bound  (replaces `?apiKey=`)
//   signed link    short-lived, resource-pinned, single-use by default
//
// Access tokens and signed links are Ed25519 JWS signed with a server key that
// lives ONLY in the SecretStore. Opaque credentials are random 32-byte values
// that are stored as SHA-256 hashes.
// ────────────────────────────────────────────────────────────────

import {
  JoseError,
  keyPairFromEd25519Seed,
  randomToken,
  sha256Base64Url,
  signJws,
  verifyJws,
  type ServerSigningKeyPair,
} from './jose.js';
import type { Principal, PrincipalType, TransportKind } from './principals.js';
import {
  SIGNED_LINK_FORBIDDEN_SCOPES,
  isScopeSubset,
  normalizeScopes,
  type Scope,
} from './scopes.js';
import type { SecretStore } from '@generatorai/secrets';

export const TOKEN_ISSUER = 'generatorai';
export const ACCESS_TOKEN_TTL_MS = 10 * 60_000;
/**
 * How long a paired device may keep resuming its session before the user has
 * to pair again.
 *
 * This is the value that decides "my phone stopped working, I have to scan the
 * QR code again". It is a *sliding* window: every refresh mints a fresh
 * credential with a full TTL, so an actively used device never expires. Only a
 * device left untouched for the whole window does.
 *
 * Overridable per deployment via `security.sessionTtlHours`
 * (`GENERATORAI_SESSION_TTL_HOURS`) — shorter for shared machines, longer for
 * a personal laptop.
 */
export const RESUME_CREDENTIAL_TTL_MS = 48 * 60 * 60_000;
export const STREAM_TICKET_TTL_MS = 30_000;
export const PAIRING_GRANT_TTL_MS = 10 * 60_000;
export const SIGNED_LINK_MAX_TTL_MS = 60 * 60_000;

export interface AccessTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  nbf: number;
  jti: string;
  principal_type: PrincipalType;
  device_id?: string;
  owner_id?: string;
  scopes: Scope[];
  session_version: number;
  cnf?: { jkt: string };
  name?: string;
}

export interface SignedLinkClaims {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  nbf: number;
  jti: string;
  principal_type: 'signed-link';
  scopes: Scope[];
  resource_type: string;
  resource_id: string;
  max_uses: number;
}

export class TokenError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'MALFORMED'
      | 'BAD_SIGNATURE'
      | 'EXPIRED'
      | 'NOT_YET_VALID'
      | 'WRONG_AUDIENCE'
      | 'WRONG_ISSUER'
      | 'SCOPE_ESCALATION'
      | 'FORBIDDEN_SCOPE',
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

export interface TokenServiceOptions {
  /** Audience — the server identity these tokens are valid for. */
  audience: string;
  secretStore: SecretStore;
}

export class TokenService {
  private keyPair: ServerSigningKeyPair | null = null;

  constructor(private readonly options: TokenServiceOptions) {}

  /** Loads (or creates) the Ed25519 signing key from the vault. */
  async initialize(): Promise<void> {
    const seed = await this.options.secretStore.getOrCreateRandom('system', 'token-signing-seed', 32);
    this.keyPair = keyPairFromEd25519Seed(Buffer.from(seed));
  }

  private keys(): ServerSigningKeyPair {
    if (!this.keyPair) {
      throw new TokenError('TokenService.initialize() has not been called', 'MALFORMED');
    }
    return this.keyPair;
  }

  /** Public JWK of the token signing key — safe to publish (used by the relay). */
  publicJwk(): Record<string, unknown> {
    return this.keys().publicJwk as unknown as Record<string, unknown>;
  }

  // ── Access tokens ──────────────────────────────────────────────

  mintAccessToken(params: {
    principalType: PrincipalType;
    subject: string;
    scopes: readonly Scope[];
    sessionVersion: number;
    /** DPoP key thumbprint the token is sender-constrained to. */
    keyThumbprint?: string | undefined;
    deviceId?: string | undefined;
    ownerId?: string | undefined;
    displayName?: string | undefined;
    ttlMs?: number;
    now?: number;
  }): { token: string; expiresAt: number; jti: string } {
    const now = params.now ?? Date.now();
    const ttl = Math.min(params.ttlMs ?? ACCESS_TOKEN_TTL_MS, 15 * 60_000);
    const exp = now + ttl;
    const jti = randomToken(16);
    const claims: AccessTokenClaims = {
      iss: TOKEN_ISSUER,
      aud: this.options.audience,
      sub: params.subject,
      iat: Math.floor(now / 1000),
      nbf: Math.floor(now / 1000),
      exp: Math.floor(exp / 1000),
      jti,
      principal_type: params.principalType,
      scopes: normalizeScopes(params.scopes),
      session_version: params.sessionVersion,
      ...(params.deviceId ? { device_id: params.deviceId } : {}),
      ...(params.ownerId ? { owner_id: params.ownerId } : {}),
      ...(params.displayName ? { name: params.displayName } : {}),
      ...(params.keyThumbprint ? { cnf: { jkt: params.keyThumbprint } } : {}),
    };
    const token = signJws({
      alg: 'EdDSA',
      privateKey: this.keys().privateKey,
      header: { typ: 'at+jwt' },
      payload: claims as unknown as Record<string, unknown>,
    });
    return { token, expiresAt: exp, jti };
  }

  verifyAccessToken(token: string, now = Date.now()): AccessTokenClaims {
    let payload: Record<string, unknown>;
    try {
      payload = verifyJws({ token, publicKey: this.keys().publicKey, alg: 'EdDSA' });
    } catch (err) {
      if (err instanceof JoseError && err.code === 'BAD_SIGNATURE') {
        throw new TokenError('Access token signature is invalid', 'BAD_SIGNATURE');
      }
      throw new TokenError('Access token is malformed', 'MALFORMED');
    }
    const claims = payload as unknown as AccessTokenClaims;
    if (claims.iss !== TOKEN_ISSUER) throw new TokenError('Unexpected issuer', 'WRONG_ISSUER');
    if (claims.aud !== this.options.audience) {
      throw new TokenError('Token was issued for a different server', 'WRONG_AUDIENCE');
    }
    const nowSec = Math.floor(now / 1000);
    // 5s leeway absorbs sub-second clock differences without meaningfully
    // extending the token lifetime.
    if (typeof claims.exp !== 'number' || claims.exp + 5 < nowSec) {
      throw new TokenError('Access token has expired', 'EXPIRED');
    }
    if (typeof claims.nbf === 'number' && claims.nbf - 5 > nowSec) {
      throw new TokenError('Access token is not yet valid', 'NOT_YET_VALID');
    }
    claims.scopes = normalizeScopes(claims.scopes);
    return claims;
  }

  // ── Opaque credentials (resume / pairing / tickets) ────────────

  /** Creates an opaque secret + its stored hash. The secret is returned ONCE. */
  createOpaqueCredential(bytes = 32): { secret: string; hash: string } {
    const secret = randomToken(bytes);
    return { secret, hash: sha256Base64Url(secret) };
  }

  hashOpaque(secret: string): string {
    return sha256Base64Url(secret);
  }

  // ── Signed links ───────────────────────────────────────────────

  mintSignedLink(params: {
    scopes: readonly Scope[];
    /** Scopes of the principal creating the link — the link cannot exceed them. */
    grantorScopes: readonly Scope[];
    resourceType: string;
    resourceId: string;
    ttlMs: number;
    maxUses?: number;
    now?: number;
  }): { token: string; expiresAt: number; jti: string } {
    const scopes = normalizeScopes(params.scopes);
    const forbidden = scopes.filter((s) => SIGNED_LINK_FORBIDDEN_SCOPES.includes(s));
    if (forbidden.length > 0) {
      throw new TokenError(
        `Signed links must not grant: ${forbidden.join(', ')}`,
        'FORBIDDEN_SCOPE',
      );
    }
    if (!isScopeSubset(scopes, params.grantorScopes)) {
      throw new TokenError(
        'A signed link cannot grant scopes the creator does not hold',
        'SCOPE_ESCALATION',
      );
    }
    const now = params.now ?? Date.now();
    const exp = now + Math.min(params.ttlMs, SIGNED_LINK_MAX_TTL_MS);
    const jti = randomToken(16);
    const claims: SignedLinkClaims = {
      iss: TOKEN_ISSUER,
      aud: this.options.audience,
      sub: `link:${jti}`,
      iat: Math.floor(now / 1000),
      nbf: Math.floor(now / 1000),
      exp: Math.floor(exp / 1000),
      jti,
      principal_type: 'signed-link',
      scopes,
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      max_uses: params.maxUses ?? 1,
    };
    const token = signJws({
      alg: 'EdDSA',
      privateKey: this.keys().privateKey,
      header: { typ: 'link+jwt' },
      payload: claims as unknown as Record<string, unknown>,
    });
    return { token, expiresAt: exp, jti };
  }

  verifySignedLink(token: string, now = Date.now()): SignedLinkClaims {
    const claims = this.verifyAccessToken(token, now) as unknown as SignedLinkClaims;
    if (claims.principal_type !== 'signed-link') {
      throw new TokenError('Token is not a signed link', 'MALFORMED');
    }
    return claims;
  }
}

/** Builds the request Principal from verified access-token claims. */
export function principalFromClaims(
  claims: AccessTokenClaims,
  transport: TransportKind,
): Principal {
  return {
    type: claims.principal_type,
    id: claims.sub,
    scopes: claims.scopes,
    sessionVersion: claims.session_version,
    transport,
    ...(claims.name ? { displayName: claims.name } : {}),
    ...(claims.device_id ? { deviceId: claims.device_id } : {}),
    ...(claims.owner_id ? { ownerId: claims.owner_id } : {}),
    ...(claims.cnf?.jkt ? { keyThumbprint: claims.cnf.jkt } : {}),
  };
}

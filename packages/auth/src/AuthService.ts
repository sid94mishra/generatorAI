// ────────────────────────────────────────────────────────────────
// AuthService — turns an incoming request into a Principal.
//
// Accepted credentials, in order of preference:
//
//   1. `Authorization: DPoP <access-token>` + `DPoP: <proof>`
//      Per-device, sender-constrained, scoped. The only credential a remote
//      client should ever use.
//   2. `Authorization: Bearer <service-account-secret>`
//      CI / automation. Includes the deprecated global `GENERATORAI_API_KEY`.
//   3. `?ticket=<stream-ticket>` on stream endpoints only.
//      Single-use, 30 s, minted by an already-authenticated DPoP call. This is
//      what replaces long-lived `?apiKey=` in `EventSource` URLs.
//   4. `?link=<signed-link>` for narrowly scoped shares.
//   5. Explicit development loopback override.
//
// Transport NEVER grants authority: a loopback request with no credential is
// rejected unless the operator opted in with
// `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1`.
// ────────────────────────────────────────────────────────────────

import { DpopError, isNonceChallenge } from './dpop.js';
import type { DpopVerifier } from './dpop.js';
import { TokenError, principalFromClaims } from './TokenService.js';
import type { TokenService } from './TokenService.js';
import { AuditAction, type SecurityAuditService } from './SecurityAuditService.js';
import { ALL_SCOPES, normalizeScopes, type Scope } from './scopes.js';
import { sha256Base64Url, timingSafeEqualString } from './jose.js';
import type {
  IDeviceRepository,
  IServiceAccountRepository,
  IStreamTicketRepository,
} from './ports.js';
import type { Principal, TransportKind } from './principals.js';

export type AuthFailureCode =
  | 'MISSING_CREDENTIAL'
  | 'INVALID_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'INVALID_PROOF'
  | 'PROOF_REQUIRED'
  | 'NONCE_REQUIRED'
  | 'DEVICE_REVOKED'
  | 'CREDENTIAL_SUPERSEDED'
  | 'INVALID_TICKET'
  | 'INVALID_LINK'
  | 'INSECURE_TRANSPORT';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: AuthFailureCode,
    readonly status = 401,
    /** Value for the `DPoP-Nonce` response header, when a nonce is demanded. */
    readonly nonce?: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthRequest {
  method: string;
  /** Absolute URL including query. */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  remoteAddress?: string | undefined;
  requestId?: string | undefined;
  /** True when the socket's local + remote address are both loopback. */
  isLoopback: boolean;
  /** Set for `/api/stream` and WebSocket upgrades, which accept tickets. */
  allowStreamTicket?: boolean;
  /** For stream tickets: the scope/id the caller is asking to subscribe to. */
  streamScope?: { scope: string; id: string | null } | undefined;
}

export interface AuthServiceOptions {
  tokens: TokenService;
  dpop: DpopVerifier;
  devices: IDeviceRepository;
  serviceAccounts: IServiceAccountRepository;
  streamTickets: IStreamTicketRepository;
  audit: SecurityAuditService;
  /** Deprecated global key. Kept working during migration. */
  legacyApiKey?: string | undefined;
  /** Scopes granted to the legacy global key. Defaults to everything. */
  legacyApiKeyScopes?: readonly Scope[];
  /** Allow unauthenticated loopback requests (dev only). */
  allowUnauthenticatedLoopback?: boolean;
  logger?: { warn(msg: string, meta?: unknown): void; debug?(msg: string, meta?: unknown): void };
}

export class AuthService {
  constructor(private readonly options: AuthServiceOptions) {}

  get allowsUnauthenticatedLoopback(): boolean {
    return this.options.allowUnauthenticatedLoopback === true;
  }

  get hasLegacyApiKey(): boolean {
    return Boolean(this.options.legacyApiKey);
  }

  /** Resolves the Principal, or throws `AuthError`. */
  async authenticate(req: AuthRequest): Promise<Principal> {
    const transport = classifyTransport(req);
    const authorization = firstHeader(req.headers['authorization']);

    try {
      if (authorization?.startsWith('DPoP ')) {
        return await this.authenticateDpop(req, authorization.slice(5).trim(), transport);
      }
      if (authorization?.startsWith('Bearer ')) {
        return await this.authenticateBearer(req, authorization.slice(7).trim(), transport);
      }
      const ticket = firstQuery(req.query['ticket']);
      if (ticket && req.allowStreamTicket) {
        return await this.authenticateStreamTicket(req, ticket, transport);
      }
      const link = firstQuery(req.query['link']);
      if (link) {
        return this.authenticateSignedLink(req, link, transport);
      }
      // Legacy `?apiKey=` — accepted ONLY on loopback and only while the
      // deprecated global key is configured, so existing local setups keep
      // working during the migration window. Never accepted off-loopback.
      const legacyQueryKey = firstQuery(req.query['apiKey']);
      if (legacyQueryKey && this.options.legacyApiKey && req.isLoopback) {
        this.options.logger?.warn(
          '[Auth] Deprecated ?apiKey= query credential used — migrate to stream tickets.',
        );
        return await this.authenticateBearer(req, legacyQueryKey, transport);
      }

      if (this.options.allowUnauthenticatedLoopback && req.isLoopback) {
        return {
          type: 'local-desktop',
          id: 'local',
          displayName: 'Local (unauthenticated dev mode)',
          scopes: ALL_SCOPES,
          transport,
          unauthenticated: true,
        };
      }

      throw new AuthError(
        'Missing credential. Send `Authorization: DPoP <token>` with a `DPoP` proof.',
        'MISSING_CREDENTIAL',
      );
    } catch (err) {
      if (err instanceof AuthError) {
        this.options.audit.record({
          action: AuditAction.authFailure,
          result: 'failure',
          reasonCode: err.code,
          requestId: req.requestId ?? null,
          sourceAddress: req.remoteAddress ?? null,
          transport,
          severity: 'warn',
        });
      }
      throw err;
    }
  }

  // ── DPoP-bound device tokens ───────────────────────────────────

  private async authenticateDpop(
    req: AuthRequest,
    accessToken: string,
    transport: TransportKind,
  ): Promise<Principal> {
    let claims;
    try {
      claims = this.options.tokens.verifyAccessToken(accessToken);
    } catch (err) {
      if (err instanceof TokenError && err.code === 'EXPIRED') {
        throw new AuthError('Access token has expired', 'EXPIRED_TOKEN');
      }
      throw new AuthError('Access token is not valid', 'INVALID_TOKEN');
    }

    try {
      await this.options.dpop.verify({
        proof: req.headers['dpop'],
        method: req.method,
        url: req.url,
        accessToken,
        expectedThumbprint: claims.cnf?.jkt,
      });
    } catch (err) {
      if (err instanceof DpopError) {
        if (isNonceChallenge(err.code)) {
          // Hand the client a server nonce: a skewed clock can still connect,
          // and a client holding a spent nonce gets a fresh one.
          const nonce = await this.options.dpop.issueNonce();
          throw new AuthError(err.message, 'NONCE_REQUIRED', 401, nonce);
        }
        throw new AuthError(err.message, 'INVALID_PROOF');
      }
      throw new AuthError('DPoP proof verification failed', 'INVALID_PROOF');
    }

    // A DPoP-bound token must never be accepted as a plain bearer token, and
    // vice versa — enforced by requiring `cnf.jkt` here.
    if (!claims.cnf?.jkt) {
      throw new AuthError('Token is not sender-constrained', 'INVALID_TOKEN');
    }

    if (claims.principal_type === 'paired-device' && claims.device_id) {
      const device = await this.options.devices.findById(claims.device_id);
      if (!device || device.revokedAt != null) {
        throw new AuthError('Device has been revoked', 'DEVICE_REVOKED', 401);
      }
      if (device.jwkThumbprint !== claims.cnf.jkt) {
        throw new AuthError('Token key does not match the registered device key', 'INVALID_TOKEN');
      }
      // Credential-generation check with grace window: a token from the
      // previous generation stays valid only while the grace period is open.
      if (claims.session_version !== device.credentialVersion) {
        const graceOpen =
          device.previousCredentialGraceUntil != null &&
          device.previousCredentialGraceUntil > Date.now() &&
          claims.session_version === device.credentialVersion - 1;
        if (!graceOpen) {
          throw new AuthError('Credential has been superseded', 'CREDENTIAL_SUPERSEDED', 401);
        }
      }
      // Scopes come from the LIVE device record, not the token, so a scope
      // reduction takes effect without waiting for token expiry.
      const scopes = normalizeScopes(device.scopes);
      void this.options.devices.touch(device.deviceId, Date.now(), transport).catch(() => undefined);
      return {
        type: 'paired-device',
        id: device.deviceId,
        displayName: device.name,
        deviceId: device.deviceId,
        ownerId: device.ownerId,
        scopes,
        keyThumbprint: device.jwkThumbprint,
        sessionVersion: device.credentialVersion,
        transport,
      };
    }

    return principalFromClaims(claims, transport);
  }

  // ── Bearer service accounts / legacy key ───────────────────────

  private async authenticateBearer(
    req: AuthRequest,
    secret: string,
    transport: TransportKind,
  ): Promise<Principal> {
    if (this.options.legacyApiKey && timingSafeEqualString(this.options.legacyApiKey, secret)) {
      return {
        type: 'service-account',
        id: 'legacy-api-key',
        displayName: 'Legacy API key (deprecated)',
        scopes: normalizeScopes(this.options.legacyApiKeyScopes ?? ALL_SCOPES),
        transport,
      };
    }

    const account = await this.options.serviceAccounts.findByHash(sha256Base64Url(secret));
    if (!account || account.revokedAt != null) {
      throw new AuthError('Credential is not valid', 'INVALID_TOKEN');
    }
    void this.options.serviceAccounts.markUsed(account.accountId, Date.now()).catch(() => undefined);
    return {
      type: 'service-account',
      id: account.accountId,
      displayName: account.name,
      scopes: normalizeScopes(account.scopes),
      transport,
    };
  }

  // ── Stream tickets ─────────────────────────────────────────────

  private async authenticateStreamTicket(
    req: AuthRequest,
    ticket: string,
    transport: TransportKind,
  ): Promise<Principal> {
    const record = await this.options.streamTickets.consume(sha256Base64Url(ticket), Date.now());
    if (!record) {
      throw new AuthError('Stream ticket is invalid, expired or already used', 'INVALID_TICKET');
    }
    // The ticket is pinned to the exact subscription it was minted for, so a
    // leaked ticket cannot be redirected at another chat/run.
    if (req.streamScope) {
      const scopeMatches = record.scope === req.streamScope.scope;
      const idMatches = (record.scopeId ?? null) === (req.streamScope.id ?? null);
      if (!scopeMatches || !idMatches) {
        throw new AuthError('Stream ticket does not cover this subscription', 'INVALID_TICKET', 403);
      }
    }
    if (record.deviceId) {
      const device = await this.options.devices.findById(record.deviceId);
      if (!device || device.revokedAt != null) {
        throw new AuthError('Device has been revoked', 'DEVICE_REVOKED', 401);
      }
    }
    this.options.audit.record({
      action: AuditAction.streamTicketConsumed,
      result: 'success',
      resourceType: 'stream',
      resourceId: record.scopeId,
      requestId: req.requestId ?? null,
      transport,
    });
    return {
      type: record.principalType as Principal['type'],
      id: record.principalId,
      scopes: normalizeScopes(record.scopes),
      transport,
      credentialKind: 'stream-ticket',
      ...(record.deviceId ? { deviceId: record.deviceId } : {}),
    };
  }

  // ── Signed links ───────────────────────────────────────────────

  private authenticateSignedLink(
    req: AuthRequest,
    link: string,
    transport: TransportKind,
  ): Principal {
    try {
      const claims = this.options.tokens.verifySignedLink(link);
      return {
        type: 'signed-link',
        id: claims.jti,
        scopes: normalizeScopes(claims.scopes),
        transport,
        credentialKind: 'signed-link',
        resource: { type: claims.resource_type, id: claims.resource_id },
      };
    } catch {
      throw new AuthError('Signed link is invalid or expired', 'INVALID_LINK');
    }
  }

  // ── Stream ticket minting ──────────────────────────────────────

  async issueStreamTicket(params: {
    principal: Principal;
    scope: string;
    scopeId: string | null;
    ttlMs?: number;
  }): Promise<{ ticket: string; expiresAt: number }> {
    const now = Date.now();
    const ttl = Math.min(params.ttlMs ?? 30_000, 60_000);
    const { secret, hash } = this.options.tokens.createOpaqueCredential(32);
    await this.options.streamTickets.create({
      ticketHash: hash,
      principalId: params.principal.id,
      principalType: params.principal.type,
      deviceId: params.principal.deviceId ?? null,
      scopes: normalizeScopes(params.principal.scopes),
      scope: params.scope,
      scopeId: params.scopeId,
      createdAt: now,
      expiresAt: now + ttl,
      consumedAt: null,
    });
    this.options.audit.record({
      action: AuditAction.streamTicketIssued,
      result: 'success',
      principal: params.principal,
      resourceType: 'stream',
      resourceId: params.scopeId,
    });
    return { ticket: secret, expiresAt: now + ttl };
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function firstQuery(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function classifyTransport(req: AuthRequest): TransportKind {
  const relayHeader = firstHeader(req.headers['x-generatorai-transport']);
  if (relayHeader === 'relay') return 'relay';
  if (relayHeader === 'ssh') return 'ssh';
  if (req.isLoopback) return 'loopback';
  return 'lan';
}

/** True when an address is an IPv4/IPv6 loopback (or its IPv4-mapped form). */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const normalized = address.replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
  return (
    normalized === '127.0.0.1' ||
    normalized.startsWith('127.') ||
    normalized === '::1' ||
    normalized === 'localhost'
  );
}

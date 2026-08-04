// ────────────────────────────────────────────────────────────────
// DeviceService — pairing grants, device registration, credential
// rotation and revocation.
//
// Patterns adopted from the Orca reference implementation (plan §5):
//   * Pending-device coalescing — reopening the pairing dialog rotates the
//     existing pending entry instead of minting unlimited grants.
//   * Explicit rotation invalidates previously displayed (possibly leaked)
//     pairing material.
//   * Write-before-valid — a device credential is only returned to the client
//     after it has been durably persisted.
//   * Current + grace credential versions — an interrupted rotation cannot
//     lock out a legitimate client.
//   * Attempt limits + TTL on every bootstrap credential.
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import { importPublicJwk, jwkThumbprint, sha256Base64Url } from './jose.js';
import {
  ACCESS_TOKEN_TTL_MS,
  PAIRING_GRANT_TTL_MS,
  RESUME_CREDENTIAL_TTL_MS,
} from './TokenService.js';
import type { TokenService } from './TokenService.js';
import { AuditAction, type SecurityAuditService } from './SecurityAuditService.js';
import {
  DEFAULT_CLI_SCOPES,
  DEFAULT_DEVICE_SCOPES,
  DEFAULT_MOBILE_SCOPES,
  HIGH_RISK_SCOPES,
  isScopeSubset,
  normalizeScopes,
  type Scope,
} from './scopes.js';
import type {
  DeviceConnectionMode,
  DevicePlatform,
  DeviceRecord,
  IDeviceRepository,
  IPairingGrantRepository,
  IRelayRevokeOutboxRepository,
  PairingGrantRecord,
} from './ports.js';
import type { Principal } from './principals.js';

export class PairingError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_GRANT'
      | 'EXPIRED'
      | 'CONSUMED'
      | 'REVOKED'
      | 'TOO_MANY_ATTEMPTS'
      | 'THROTTLED'
      | 'INVALID_KEY'
      | 'DUPLICATE_KEY'
      | 'SCOPE_ESCALATION',
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

export interface CreatePairingGrantParams {
  deviceNameHint: string;
  platform: DevicePlatform;
  requestedScopes?: readonly Scope[];
  createdBy: Principal;
  ttlMs?: number;
  maxAttempts?: number;
  relayInvite?: string | null;
}

export interface PairingGrantResult {
  grantId: string;
  /** The single-use pairing token. Displayed once; only its hash is stored. */
  pairingToken: string;
  expiresAt: number;
  requestedScopes: Scope[];
  deviceNameHint: string;
  platform: DevicePlatform;
}

export interface CompletePairingParams {
  pairingToken: string;
  /** Public JWK the device will sign DPoP proofs with. */
  publicJwk: unknown;
  deviceName?: string;
  platform?: DevicePlatform;
  connectionMode?: DeviceConnectionMode;
  sourceAddress?: string | null;
  requestId?: string | null;
}

export interface DeviceSessionResult {
  deviceId: string;
  deviceName: string;
  scopes: Scope[];
  accessToken: string;
  accessTokenExpiresAt: number;
  /** Opaque resume credential. Returned once per rotation. */
  resumeSecret: string;
  resumeExpiresAt: number;
  credentialVersion: number;
}

export function defaultScopesForPlatform(platform: DevicePlatform): readonly Scope[] {
  switch (platform) {
    case 'mobile':
      return DEFAULT_MOBILE_SCOPES;
    case 'cli':
      return DEFAULT_CLI_SCOPES;
    default:
      return DEFAULT_DEVICE_SCOPES;
  }
}

export interface DeviceServiceOptions {
  devices: IDeviceRepository;
  pairing: IPairingGrantRepository;
  tokens: TokenService;
  audit: SecurityAuditService;
  relayOutbox?: IRelayRevokeOutboxRepository | undefined;
  /** Default owner until multi-user identity lands (Phase 7). */
  defaultOwnerId?: string;
  /**
   * How long a device may keep resuming before it must pair again.
   * Defaults to {@link RESUME_CREDENTIAL_TTL_MS}. Sliding — refreshed on
   * every rotation, so only an idle device expires.
   */
  resumeCredentialTtlMs?: number | undefined;
  logger?: { warn(msg: string, meta?: unknown): void; info(msg: string, meta?: unknown): void };
}

/** Bounded, per-source throttle for unauthenticated pairing attempts. */
class AttemptThrottle {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 5000,
  ) {}

  hit(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size >= this.maxKeys) this.evict(now);
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.limit;
  }

  private evict(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size >= this.maxKeys) {
      // Still full — drop the oldest quarter rather than growing unbounded.
      const keys = [...this.buckets.keys()].slice(0, Math.floor(this.maxKeys / 4));
      for (const key of keys) this.buckets.delete(key);
    }
  }
}

export class DeviceService {
  private readonly perSourceThrottle = new AttemptThrottle(10, 60_000);
  private readonly globalThrottle = new AttemptThrottle(60, 60_000);
  /**
   * Resolved once so a malformed override cannot mint a credential that has
   * already expired (or never expires) halfway through the process lifetime.
   */
  private readonly resumeTtlMs: number;

  constructor(private readonly deps: DeviceServiceOptions) {
    const configured = deps.resumeCredentialTtlMs;
    this.resumeTtlMs =
      typeof configured === 'number' && Number.isFinite(configured) && configured > 0
        ? configured
        : RESUME_CREDENTIAL_TTL_MS;
  }

  // ── Pairing ────────────────────────────────────────────────────

  /**
   * Creates (or rotates) the pairing grant for a pending device.
   *
   * Coalescing: any previously issued, unconsumed grant for the same
   * `deviceNameHint` is revoked first, so a QR dialog that is closed and
   * reopened cannot leave a trail of live credentials behind.
   */
  async createPairingGrant(params: CreatePairingGrantParams): Promise<PairingGrantResult> {
    const now = Date.now();
    const requested = normalizeScopes(params.requestedScopes ?? defaultScopesForPlatform(params.platform));
    // A pairing grant can never confer more authority than its creator holds.
    if (!isScopeSubset(requested, params.createdBy.scopes)) {
      throw new PairingError(
        'Cannot request scopes beyond the creating principal',
        'SCOPE_ESCALATION',
      );
    }

    await this.deps.pairing.revokePendingFor(params.deviceNameHint, now);

    const { secret, hash } = this.deps.tokens.createOpaqueCredential(32);
    const grant: PairingGrantRecord = {
      grantId: crypto.randomUUID(),
      tokenHash: hash,
      deviceNameHint: params.deviceNameHint,
      platform: params.platform,
      requestedScopes: requested,
      createdAt: now,
      expiresAt: now + Math.min(params.ttlMs ?? PAIRING_GRANT_TTL_MS, PAIRING_GRANT_TTL_MS),
      consumedAt: null,
      revokedAt: null,
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 5,
      relayInvite: params.relayInvite ?? null,
      createdByPrincipal: `${params.createdBy.type}:${params.createdBy.id}`,
    };
    // Write-before-valid: persist first, hand out the token second.
    await this.deps.pairing.create(grant);

    this.deps.audit.record({
      action: AuditAction.pairingCreated,
      result: 'success',
      principal: params.createdBy,
      resourceType: 'pairing_grant',
      resourceId: grant.grantId,
      metadata: {
        deviceNameHint: params.deviceNameHint,
        platform: params.platform,
        scopes: requested,
        expiresAt: grant.expiresAt,
      },
      severity: requested.some((s) => HIGH_RISK_SCOPES.includes(s)) ? 'warn' : 'info',
    });

    return {
      grantId: grant.grantId,
      pairingToken: secret,
      expiresAt: grant.expiresAt,
      requestedScopes: requested,
      deviceNameHint: grant.deviceNameHint,
      platform: grant.platform,
    };
  }

  async revokePairingGrant(grantId: string, principal: Principal): Promise<void> {
    await this.deps.pairing.revoke(grantId, Date.now());
    this.deps.audit.record({
      action: AuditAction.pairingRevoked,
      result: 'success',
      principal,
      resourceType: 'pairing_grant',
      resourceId: grantId,
    });
  }

  async listPendingPairings(): Promise<PairingGrantRecord[]> {
    return this.deps.pairing.listPending(Date.now());
  }

  /**
   * Exchanges a pairing grant for a durable, key-bound device credential.
   *
   * The pairing token is consumed atomically; a race between two clients can
   * therefore only ever produce one device.
   */
  async completePairing(params: CompletePairingParams): Promise<DeviceSessionResult> {
    const now = Date.now();
    const source = params.sourceAddress ?? 'unknown';
    if (!this.globalThrottle.hit('global', now) || !this.perSourceThrottle.hit(source, now)) {
      this.deps.audit.record({
        action: AuditAction.rateLimited,
        result: 'denied',
        reasonCode: 'pairing_throttled',
        sourceAddress: params.sourceAddress ?? null,
        requestId: params.requestId ?? null,
        severity: 'warn',
      });
      throw new PairingError('Too many pairing attempts — try again shortly', 'THROTTLED');
    }

    const tokenHash = sha256Base64Url(params.pairingToken);
    const grant = await this.deps.pairing.findByHash(tokenHash);
    if (!grant) {
      this.auditPairingFailure('unknown_grant', params);
      throw new PairingError('Pairing code is not valid', 'INVALID_GRANT');
    }
    if (grant.revokedAt != null) {
      this.auditPairingFailure('revoked', params, grant.grantId);
      throw new PairingError('Pairing code has been revoked', 'REVOKED');
    }
    if (grant.consumedAt != null) {
      this.auditPairingFailure('already_consumed', params, grant.grantId);
      throw new PairingError('Pairing code has already been used', 'CONSUMED');
    }
    if (grant.expiresAt <= now) {
      this.auditPairingFailure('expired', params, grant.grantId);
      throw new PairingError('Pairing code has expired', 'EXPIRED');
    }
    const attempts = await this.deps.pairing.incrementAttempts(grant.grantId);
    if (attempts > grant.maxAttempts) {
      await this.deps.pairing.revoke(grant.grantId, now);
      this.auditPairingFailure('too_many_attempts', params, grant.grantId);
      throw new PairingError('Too many attempts for this pairing code', 'TOO_MANY_ATTEMPTS');
    }

    // Validate the device key BEFORE consuming the grant, so a malformed key
    // does not burn a single-use code.
    let thumbprint: string;
    let canonicalJwk: string;
    try {
      const imported = importPublicJwk(params.publicJwk);
      thumbprint = jwkThumbprint(imported.jwk);
      canonicalJwk = JSON.stringify(imported.jwk);
    } catch (err) {
      this.auditPairingFailure('invalid_key', params, grant.grantId);
      throw new PairingError(
        err instanceof Error ? err.message : 'Invalid device public key',
        'INVALID_KEY',
      );
    }

    const existing = await this.deps.devices.findByThumbprint(thumbprint);
    if (existing && existing.revokedAt == null) {
      this.auditPairingFailure('duplicate_key', params, grant.grantId);
      throw new PairingError(
        'This device key is already registered. Remove the existing device first.',
        'DUPLICATE_KEY',
      );
    }

    const consumed = await this.deps.pairing.consume(grant.grantId, now);
    if (!consumed) {
      this.auditPairingFailure('consume_race', params, grant.grantId);
      throw new PairingError('Pairing code has already been used', 'CONSUMED');
    }

    const device: DeviceRecord = {
      deviceId: crypto.randomUUID(),
      ownerId: this.deps.defaultOwnerId ?? 'local',
      name: (params.deviceName ?? grant.deviceNameHint).slice(0, 120),
      platform: params.platform ?? grant.platform,
      publicJwk: canonicalJwk,
      jwkThumbprint: thumbprint,
      scopes: grant.requestedScopes,
      createdAt: now,
      lastSeenAt: now,
      lastSeenTransport: null,
      revokedAt: null,
      revokedReason: null,
      credentialVersion: 1,
      previousCredentialGraceUntil: null,
      connectionMode: params.connectionMode ?? 'auto',
      relayBinding: null,
    };
    await this.deps.devices.create(device);

    const session = await this.issueSession(device, thumbprint, now);

    this.deps.audit.record({
      action: AuditAction.deviceCreated,
      result: 'success',
      resourceType: 'device',
      resourceId: device.deviceId,
      requestId: params.requestId ?? null,
      sourceAddress: params.sourceAddress ?? null,
      metadata: {
        name: device.name,
        platform: device.platform,
        scopes: device.scopes,
        thumbprint,
      },
      severity: device.scopes.some((s) => HIGH_RISK_SCOPES.includes(s)) ? 'warn' : 'info',
    });
    this.deps.audit.record({
      action: AuditAction.pairingConsumed,
      result: 'success',
      resourceType: 'pairing_grant',
      resourceId: grant.grantId,
      metadata: { deviceId: device.deviceId },
    });

    return session;
  }

  // ── Sessions ───────────────────────────────────────────────────

  /**
   * Rotates the resume credential and mints a fresh access token.
   *
   * Rotation semantics: the NEW credential is written first, then the previous
   * generation is given a grace window rather than being deleted, so a client
   * that crashes between "received new secret" and "persisted new secret" can
   * still recover with the old one.
   */
  async refreshSession(params: {
    resumeSecret: string;
    /** Thumbprint proven by the DPoP proof on the refresh request. */
    keyThumbprint: string;
    transport?: string;
  }): Promise<DeviceSessionResult> {
    const now = Date.now();
    const credential = await this.deps.devices.findCredentialByHash(
      sha256Base64Url(params.resumeSecret),
    );
    if (!credential || credential.revokedAt != null) {
      throw new PairingError('Resume credential is not valid', 'INVALID_GRANT');
    }
    if (credential.expiresAt != null && credential.expiresAt <= now) {
      throw new PairingError('Resume credential has expired', 'EXPIRED');
    }
    const device = await this.deps.devices.findById(credential.deviceId);
    if (!device || device.revokedAt != null) {
      throw new PairingError('Device has been revoked', 'REVOKED');
    }
    // Sender-constraint: the refresh must be proven with the device's key.
    if (device.jwkThumbprint !== params.keyThumbprint) {
      throw new PairingError('Refresh proof key does not match the device', 'INVALID_KEY');
    }

    await this.deps.devices.markCredentialUsed(credential.credentialId, now);
    const session = await this.issueSession(device, params.keyThumbprint, now, credential.credentialId);
    await this.deps.devices.touch(device.deviceId, now, params.transport ?? 'unknown');

    this.deps.audit.record({
      action: AuditAction.tokenRefreshed,
      result: 'success',
      resourceType: 'device',
      resourceId: device.deviceId,
      transport: params.transport ?? null,
    });
    return session;
  }

  private async issueSession(
    device: DeviceRecord,
    thumbprint: string,
    now: number,
    supersededCredentialId?: string,
  ): Promise<DeviceSessionResult> {
    const nextVersion =
      supersededCredentialId != null ? device.credentialVersion + 1 : device.credentialVersion;
    const { secret, hash } = this.deps.tokens.createOpaqueCredential(32);
    const expiresAt = now + this.resumeTtlMs;

    await this.deps.devices.createCredential({
      credentialId: crypto.randomUUID(),
      deviceId: device.deviceId,
      secretHash: hash,
      version: nextVersion,
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    });

    if (supersededCredentialId != null) {
      // Grace window: the previous generation keeps working briefly so an
      // interrupted rotation cannot lock the device out.
      await this.deps.devices.update(device.deviceId, {
        credentialVersion: nextVersion,
        previousCredentialGraceUntil: now + 10 * 60_000,
      });
    }

    const access = this.deps.tokens.mintAccessToken({
      principalType: 'paired-device',
      subject: device.deviceId,
      scopes: device.scopes,
      sessionVersion: nextVersion,
      keyThumbprint: thumbprint,
      deviceId: device.deviceId,
      ownerId: device.ownerId,
      displayName: device.name,
      ttlMs: ACCESS_TOKEN_TTL_MS,
      now,
    });

    return {
      deviceId: device.deviceId,
      deviceName: device.name,
      scopes: device.scopes,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      resumeSecret: secret,
      resumeExpiresAt: expiresAt,
      credentialVersion: nextVersion,
    };
  }

  // ── Device management ──────────────────────────────────────────

  async listDevices(includeRevoked = false): Promise<DeviceRecord[]> {
    return this.deps.devices.list({ includeRevoked });
  }

  async getDevice(deviceId: string): Promise<DeviceRecord | null> {
    return this.deps.devices.findById(deviceId);
  }

  async renameDevice(deviceId: string, name: string, principal: Principal): Promise<void> {
    await this.deps.devices.update(deviceId, { name: name.slice(0, 120) });
    this.deps.audit.record({
      action: AuditAction.deviceRenamed,
      result: 'success',
      principal,
      resourceType: 'device',
      resourceId: deviceId,
      metadata: { name },
    });
  }

  /** Scope changes are clamped to the granting principal's own authority. */
  async updateDeviceScopes(
    deviceId: string,
    scopes: readonly Scope[],
    principal: Principal,
  ): Promise<Scope[]> {
    const next = normalizeScopes(scopes);
    if (!isScopeSubset(next, principal.scopes)) {
      throw new PairingError('Cannot grant scopes beyond your own', 'SCOPE_ESCALATION');
    }
    await this.deps.devices.update(deviceId, { scopes: next });
    // Force re-authentication so tokens carrying the old scope set die.
    await this.rotateCredentials(deviceId, principal, 'scopes_changed');
    this.deps.audit.record({
      action: AuditAction.deviceScopesChanged,
      result: 'success',
      principal,
      resourceType: 'device',
      resourceId: deviceId,
      metadata: { scopes: next },
      severity: next.some((s) => HIGH_RISK_SCOPES.includes(s)) ? 'warn' : 'info',
    });
    return next;
  }

  async rotateCredentials(
    deviceId: string,
    principal: Principal,
    reason = 'manual',
  ): Promise<void> {
    const now = Date.now();
    const device = await this.deps.devices.findById(deviceId);
    if (!device) return;
    await this.deps.devices.revokeCredentials(deviceId, now);
    await this.deps.devices.update(deviceId, {
      credentialVersion: device.credentialVersion + 1,
      previousCredentialGraceUntil: null,
    });
    this.deps.audit.record({
      action: AuditAction.deviceCredentialRotated,
      result: 'success',
      principal,
      resourceType: 'device',
      resourceId: deviceId,
      reasonCode: reason,
      severity: 'warn',
    });
  }

  /**
   * Revokes a device everywhere.
   *
   * Local state is authoritative and takes effect immediately. If the device
   * had a relay binding, a durable outbox entry guarantees the relay is told
   * even if it is currently unreachable (plan §17.6).
   */
  async revokeDevice(deviceId: string, reason: string, principal: Principal): Promise<void> {
    const now = Date.now();
    const device = await this.deps.devices.findById(deviceId);
    await this.deps.devices.revoke(deviceId, reason, now);
    await this.deps.devices.revokeCredentials(deviceId, now);

    if (device?.relayBinding && this.deps.relayOutbox) {
      await this.deps.relayOutbox.enqueue({
        id: crypto.randomUUID(),
        relayBinding: device.relayBinding,
        deviceId,
        enqueuedAt: now,
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
      });
      this.deps.audit.record({
        action: AuditAction.relayRevokeQueued,
        result: 'success',
        principal,
        resourceType: 'device',
        resourceId: deviceId,
        severity: 'warn',
      });
    }

    this.deps.audit.record({
      action: AuditAction.deviceRevoked,
      result: 'success',
      principal,
      resourceType: 'device',
      resourceId: deviceId,
      reasonCode: reason,
      severity: 'critical',
    });
  }

  private auditPairingFailure(
    reason: string,
    params: CompletePairingParams,
    grantId?: string,
  ): void {
    this.deps.audit.record({
      action: AuditAction.pairingFailed,
      result: 'failure',
      reasonCode: reason,
      resourceType: 'pairing_grant',
      resourceId: grantId ?? null,
      requestId: params.requestId ?? null,
      sourceAddress: params.sourceAddress ?? null,
      severity: 'warn',
    });
  }
}

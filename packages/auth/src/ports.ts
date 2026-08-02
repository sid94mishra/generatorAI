// ────────────────────────────────────────────────────────────────
// Repository ports for the auth domain.
//
// Pure interfaces — the Drizzle/SQLite implementations live in
// `packages/db/src/repositories/AuthRepositories.ts`. Keeping them here means
// `@generatorai/auth` has zero infrastructure dependencies and can be unit
// tested against in-memory fakes.
// ────────────────────────────────────────────────────────────────

import type { Scope } from './scopes.js';

// ── Devices ──────────────────────────────────────────────────────

export type DevicePlatform = 'web' | 'desktop' | 'cli' | 'mobile' | 'other';
export type DeviceConnectionMode = 'loopback' | 'lan' | 'ssh' | 'relay' | 'auto';

export interface DeviceRecord {
  deviceId: string;
  ownerId: string;
  name: string;
  platform: DevicePlatform;
  /** Canonical public JWK JSON the device signs DPoP proofs with. */
  publicJwk: string;
  /** RFC 7638 thumbprint of `publicJwk`. Unique per active device. */
  jwkThumbprint: string;
  scopes: Scope[];
  createdAt: number;
  lastSeenAt: number | null;
  lastSeenTransport: string | null;
  revokedAt: number | null;
  revokedReason: string | null;
  /** Bumped on every credential rotation; embedded in access tokens. */
  credentialVersion: number;
  /** Previous generation stays valid until this timestamp (interrupted rotation). */
  previousCredentialGraceUntil: number | null;
  connectionMode: DeviceConnectionMode;
  relayBinding: string | null;
}

export interface DeviceCredentialRecord {
  credentialId: string;
  deviceId: string;
  /** SHA-256 of the opaque resume/refresh secret. The value is never stored. */
  secretHash: string;
  version: number;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface IDeviceRepository {
  create(device: DeviceRecord): Promise<void>;
  findById(deviceId: string): Promise<DeviceRecord | null>;
  findByThumbprint(thumbprint: string): Promise<DeviceRecord | null>;
  list(filter?: { includeRevoked?: boolean }): Promise<DeviceRecord[]>;
  update(deviceId: string, patch: Partial<Omit<DeviceRecord, 'deviceId'>>): Promise<void>;
  revoke(deviceId: string, reason: string, at: number): Promise<void>;
  touch(deviceId: string, at: number, transport: string): Promise<void>;

  createCredential(credential: DeviceCredentialRecord): Promise<void>;
  findCredentialByHash(secretHash: string): Promise<DeviceCredentialRecord | null>;
  listCredentials(deviceId: string): Promise<DeviceCredentialRecord[]>;
  revokeCredentials(deviceId: string, at: number, exceptId?: string): Promise<void>;
  markCredentialUsed(credentialId: string, at: number): Promise<void>;
}

// ── Pairing grants ───────────────────────────────────────────────

export interface PairingGrantRecord {
  grantId: string;
  /** SHA-256 of the single-use pairing token. */
  tokenHash: string;
  deviceNameHint: string;
  platform: DevicePlatform;
  requestedScopes: Scope[];
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
  revokedAt: number | null;
  attempts: number;
  maxAttempts: number;
  /** Populated when the grant was minted alongside a relay invite. */
  relayInvite: string | null;
  createdByPrincipal: string;
}

export interface IPairingGrantRepository {
  create(grant: PairingGrantRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<PairingGrantRecord | null>;
  /** Atomically marks the grant consumed. Returns false when already used/expired. */
  consume(grantId: string, at: number): Promise<boolean>;
  incrementAttempts(grantId: string): Promise<number>;
  revoke(grantId: string, at: number): Promise<void>;
  /** Revokes every non-consumed grant created for the same pending device. */
  revokePendingFor(deviceNameHint: string, at: number): Promise<void>;
  listPending(now: number): Promise<PairingGrantRecord[]>;
  deleteExpired(before: number): Promise<number>;
}

// ── Replay / nonce / ticket stores ───────────────────────────────

export interface IReplayStore {
  /**
   * Records a proof id. Returns false when it has already been seen — the
   * uniqueness constraint, not the read, is authoritative.
   */
  register(jtiHash: string, expiresAt: number): Promise<boolean>;
  purge(before: number): Promise<number>;
}

export interface INonceStore {
  issue(expiresAt: number): Promise<string>;
  /** Consumes a nonce. Returns false when unknown or expired. */
  verify(nonce: string, now: number): Promise<boolean>;
  purge(before: number): Promise<number>;
}

export interface StreamTicketRecord {
  ticketHash: string;
  principalId: string;
  principalType: string;
  deviceId: string | null;
  scopes: Scope[];
  scope: string;
  scopeId: string | null;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface IStreamTicketRepository {
  create(ticket: StreamTicketRecord): Promise<void>;
  /** Atomically consumes the ticket, returning it only if it was unused + unexpired. */
  consume(ticketHash: string, now: number): Promise<StreamTicketRecord | null>;
  purge(before: number): Promise<number>;
}

// ── Audit ────────────────────────────────────────────────────────

export type AuditResult = 'success' | 'failure' | 'denied';

export interface SecurityAuditEventRecord {
  eventId: string;
  timestamp: number;
  actorPrincipalType: string;
  actorPrincipalId: string;
  actorDeviceId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  result: AuditResult;
  reasonCode: string | null;
  requestId: string | null;
  connectionId: string | null;
  transport: string | null;
  /** SHA-256 of the source address — never the raw IP. */
  sourceAddressHash: string | null;
  /** JSON, already redacted. Never contains secrets or user content. */
  metadata: string | null;
  severity: 'info' | 'warn' | 'critical';
}

export interface ISecurityAuditRepository {
  append(event: SecurityAuditEventRecord): Promise<void>;
  list(filter?: {
    limit?: number;
    since?: number;
    action?: string;
    deviceId?: string;
    result?: AuditResult;
  }): Promise<SecurityAuditEventRecord[]>;
  purge(before: number): Promise<number>;
}

// ── Relay ────────────────────────────────────────────────────────

export interface RelayRevokeOutboxRecord {
  id: string;
  relayBinding: string;
  deviceId: string;
  enqueuedAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  lastError: string | null;
}

export interface IRelayRevokeOutboxRepository {
  enqueue(record: RelayRevokeOutboxRecord): Promise<void>;
  listPending(limit: number): Promise<RelayRevokeOutboxRecord[]>;
  markAttempt(id: string, at: number, error: string | null): Promise<void>;
  /** Only called after the relay ACKs the revocation. */
  remove(id: string): Promise<void>;
}

// ── Service accounts ─────────────────────────────────────────────

export interface ServiceAccountRecord {
  accountId: string;
  name: string;
  /** SHA-256 of the bearer secret. */
  secretHash: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  /** `true` for the legacy `GENERATORAI_API_KEY`, which is deprecated. */
  legacy: boolean;
}

export interface IServiceAccountRepository {
  create(account: ServiceAccountRecord): Promise<void>;
  findByHash(secretHash: string): Promise<ServiceAccountRecord | null>;
  list(): Promise<ServiceAccountRecord[]>;
  revoke(accountId: string, at: number): Promise<void>;
  markUsed(accountId: string, at: number): Promise<void>;
}

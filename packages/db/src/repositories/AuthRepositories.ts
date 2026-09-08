// ────────────────────────────────────────────────────────────────
// Auth repositories — SQLite implementations of the ports declared in
// `@generatorai/auth`.
//
// These use prepared statements directly (rather than the Drizzle query
// builder) because every "single use" credential needs a genuinely ATOMIC
// compare-and-set: `UPDATE … WHERE consumed_at IS NULL` + `changes()` is the
// only race-free way to consume a pairing grant or stream ticket. A
// read-then-write through the ORM would let two concurrent clients both win.
// ────────────────────────────────────────────────────────────────

import type BetterSqlite3 from 'better-sqlite3';
import type {
  AuditResult,
  DeviceConnectionMode,
  DeviceCredentialRecord,
  DevicePlatform,
  DeviceRecord,
  DeviceScopeRequestRecord,
  DeviceScopeRequestStatus,
  IDeviceRepository,
  IDeviceScopeRequestRepository,
  INonceStore,
  IPairingGrantRepository,
  IRelayRevokeOutboxRepository,
  IReplayStore,
  ISecurityAuditRepository,
  IServiceAccountRepository,
  IStreamTicketRepository,
  PairingGrantRecord,
  RelayRevokeOutboxRecord,
  SecurityAuditEventRecord,
  ServiceAccountRecord,
  StreamTicketRecord,
} from '@generatorai/auth';
import type { AppDatabase } from '../index.js';

type Scope = DeviceRecord['scopes'][number];

/** Reaches through Drizzle to the better-sqlite3 handle. */
export function sqliteHandle(db: AppDatabase): BetterSqlite3.Database {
  return (db as unknown as { session: { client: BetterSqlite3.Database } }).session.client;
}

function parseScopes(json: string | null): Scope[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed.filter((v) => typeof v === 'string') as Scope[]) : [];
  } catch {
    return [];
  }
}

// ── Devices ──────────────────────────────────────────────────────

interface DeviceRow {
  device_id: string;
  owner_id: string;
  name: string;
  platform: string;
  public_jwk: string;
  jwk_thumbprint: string;
  scopes: string;
  created_at: number;
  last_seen_at: number | null;
  last_seen_transport: string | null;
  revoked_at: number | null;
  revoked_reason: string | null;
  credential_version: number;
  previous_credential_grace_until: number | null;
  connection_mode: string;
  relay_binding: string | null;
}

function toDevice(row: DeviceRow): DeviceRecord {
  return {
    deviceId: row.device_id,
    ownerId: row.owner_id,
    name: row.name,
    platform: row.platform as DevicePlatform,
    publicJwk: row.public_jwk,
    jwkThumbprint: row.jwk_thumbprint,
    scopes: parseScopes(row.scopes),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    lastSeenTransport: row.last_seen_transport,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    credentialVersion: row.credential_version,
    previousCredentialGraceUntil: row.previous_credential_grace_until,
    connectionMode: row.connection_mode as DeviceConnectionMode,
    relayBinding: row.relay_binding,
  };
}

const DEVICE_COLUMN_MAP: Record<string, string> = {
  ownerId: 'owner_id',
  name: 'name',
  platform: 'platform',
  publicJwk: 'public_jwk',
  jwkThumbprint: 'jwk_thumbprint',
  scopes: 'scopes',
  lastSeenAt: 'last_seen_at',
  lastSeenTransport: 'last_seen_transport',
  revokedAt: 'revoked_at',
  revokedReason: 'revoked_reason',
  credentialVersion: 'credential_version',
  previousCredentialGraceUntil: 'previous_credential_grace_until',
  connectionMode: 'connection_mode',
  relayBinding: 'relay_binding',
};

export class SqliteDeviceRepository implements IDeviceRepository {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase) {
    this.sqlite = sqliteHandle(db);
  }

  async create(device: DeviceRecord): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO auth_devices (
           device_id, owner_id, name, platform, public_jwk, jwk_thumbprint, scopes,
           created_at, last_seen_at, last_seen_transport, revoked_at, revoked_reason,
           credential_version, previous_credential_grace_until, connection_mode, relay_binding
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        device.deviceId,
        device.ownerId,
        device.name,
        device.platform,
        device.publicJwk,
        device.jwkThumbprint,
        JSON.stringify(device.scopes),
        device.createdAt,
        device.lastSeenAt,
        device.lastSeenTransport,
        device.revokedAt,
        device.revokedReason,
        device.credentialVersion,
        device.previousCredentialGraceUntil,
        device.connectionMode,
        device.relayBinding,
      );
  }

  async findById(deviceId: string): Promise<DeviceRecord | null> {
    const row = this.sqlite
      .prepare(`SELECT * FROM auth_devices WHERE device_id = ?`)
      .get(deviceId) as DeviceRow | undefined;
    return row ? toDevice(row) : null;
  }

  async findByThumbprint(thumbprint: string): Promise<DeviceRecord | null> {
    const row = this.sqlite
      .prepare(`SELECT * FROM auth_devices WHERE jwk_thumbprint = ? AND revoked_at IS NULL`)
      .get(thumbprint) as DeviceRow | undefined;
    return row ? toDevice(row) : null;
  }

  async list(filter?: { includeRevoked?: boolean }): Promise<DeviceRecord[]> {
    const sql = filter?.includeRevoked
      ? `SELECT * FROM auth_devices ORDER BY created_at DESC`
      : `SELECT * FROM auth_devices WHERE revoked_at IS NULL ORDER BY created_at DESC`;
    return (this.sqlite.prepare(sql).all() as DeviceRow[]).map(toDevice);
  }

  async update(deviceId: string, patch: Partial<Omit<DeviceRecord, 'deviceId'>>): Promise<void> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = DEVICE_COLUMN_MAP[key];
      // Only known columns are writable — an unexpected key can never become
      // part of the SQL string.
      if (!column || value === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(key === 'scopes' ? JSON.stringify(value) : (value as never));
    }
    if (assignments.length === 0) return;
    values.push(deviceId);
    this.sqlite
      .prepare(`UPDATE auth_devices SET ${assignments.join(', ')} WHERE device_id = ?`)
      .run(...(values as never[]));
  }

  async revoke(deviceId: string, reason: string, at: number): Promise<void> {
    this.sqlite
      .prepare(`UPDATE auth_devices SET revoked_at = ?, revoked_reason = ? WHERE device_id = ?`)
      .run(at, reason, deviceId);
  }

  async touch(deviceId: string, at: number, transport: string): Promise<void> {
    this.sqlite
      .prepare(`UPDATE auth_devices SET last_seen_at = ?, last_seen_transport = ? WHERE device_id = ?`)
      .run(at, transport, deviceId);
  }

  async createCredential(credential: DeviceCredentialRecord): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO auth_device_credentials
           (credential_id, device_id, secret_hash, version, created_at, expires_at, last_used_at, revoked_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        credential.credentialId,
        credential.deviceId,
        credential.secretHash,
        credential.version,
        credential.createdAt,
        credential.expiresAt,
        credential.lastUsedAt,
        credential.revokedAt,
      );
  }

  async findCredentialByHash(secretHash: string): Promise<DeviceCredentialRecord | null> {
    const row = this.sqlite
      .prepare(`SELECT * FROM auth_device_credentials WHERE secret_hash = ?`)
      .get(secretHash) as
      | {
          credential_id: string;
          device_id: string;
          secret_hash: string;
          version: number;
          created_at: number;
          expires_at: number | null;
          last_used_at: number | null;
          revoked_at: number | null;
        }
      | undefined;
    if (!row) return null;
    return {
      credentialId: row.credential_id,
      deviceId: row.device_id,
      secretHash: row.secret_hash,
      version: row.version,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
    };
  }

  async listCredentials(deviceId: string): Promise<DeviceCredentialRecord[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM auth_device_credentials WHERE device_id = ? ORDER BY created_at DESC`)
      .all(deviceId) as Array<Record<string, never>>;
    return rows.map((row) => ({
      credentialId: row['credential_id'] as unknown as string,
      deviceId: row['device_id'] as unknown as string,
      secretHash: row['secret_hash'] as unknown as string,
      version: row['version'] as unknown as number,
      createdAt: row['created_at'] as unknown as number,
      expiresAt: (row['expires_at'] ?? null) as unknown as number | null,
      lastUsedAt: (row['last_used_at'] ?? null) as unknown as number | null,
      revokedAt: (row['revoked_at'] ?? null) as unknown as number | null,
    }));
  }

  async revokeCredentials(deviceId: string, at: number, exceptId?: string): Promise<void> {
    if (exceptId) {
      this.sqlite
        .prepare(
          `UPDATE auth_device_credentials SET revoked_at = ?
             WHERE device_id = ? AND credential_id != ? AND revoked_at IS NULL`,
        )
        .run(at, deviceId, exceptId);
      return;
    }
    this.sqlite
      .prepare(`UPDATE auth_device_credentials SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL`)
      .run(at, deviceId);
  }

  async markCredentialUsed(credentialId: string, at: number): Promise<void> {
    // Records consumption; it does NOT revoke.
    //
    // This used to set `revoked_at` as well, which quietly disabled the whole
    // grace window: `refreshSession` rejects a revoked credential before it
    // ever reaches the "is this the previous generation, still in grace?"
    // branch. A client that received a rotated secret but was killed before
    // persisting it — a crash, a backgrounded app, a server that could not
    // write — presented the old one on its next launch and was told
    // INVALID_GRANT, permanently, with re-pairing from the host the only way
    // back. `revoked_at` now means "deliberately revoked" (device revoke,
    // unpair, sign-out) and validity is decided by generation + grace, which
    // is what the rotation was documented to do all along.
    this.sqlite
      .prepare(`UPDATE auth_device_credentials SET last_used_at = ? WHERE credential_id = ?`)
      .run(at, credentialId);
  }
}

// ── Pairing grants ───────────────────────────────────────────────

interface PairingRow {
  grant_id: string;
  token_hash: string;
  device_name_hint: string;
  platform: string;
  requested_scopes: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  revoked_at: number | null;
  attempts: number;
  max_attempts: number;
  relay_invite: string | null;
  created_by_principal: string;
}

function toGrant(row: PairingRow): PairingGrantRecord {
  return {
    grantId: row.grant_id,
    tokenHash: row.token_hash,
    deviceNameHint: row.device_name_hint,
    platform: row.platform as DevicePlatform,
    requestedScopes: parseScopes(row.requested_scopes),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    revokedAt: row.revoked_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    relayInvite: row.relay_invite,
    createdByPrincipal: row.created_by_principal,
  };
}

export class SqlitePairingGrantRepository implements IPairingGrantRepository {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase) {
    this.sqlite = sqliteHandle(db);
  }

  async create(grant: PairingGrantRecord): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO auth_pairing_grants (
           grant_id, token_hash, device_name_hint, platform, requested_scopes,
           created_at, expires_at, consumed_at, revoked_at, attempts, max_attempts,
           relay_invite, created_by_principal
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        grant.grantId,
        grant.tokenHash,
        grant.deviceNameHint,
        grant.platform,
        JSON.stringify(grant.requestedScopes),
        grant.createdAt,
        grant.expiresAt,
        grant.consumedAt,
        grant.revokedAt,
        grant.attempts,
        grant.maxAttempts,
        grant.relayInvite,
        grant.createdByPrincipal,
      );
  }

  async findByHash(tokenHash: string): Promise<PairingGrantRecord | null> {
    const row = this.sqlite
      .prepare(`SELECT * FROM auth_pairing_grants WHERE token_hash = ?`)
      .get(tokenHash) as PairingRow | undefined;
    return row ? toGrant(row) : null;
  }

  /** Atomic consume — `changes()` is 1 for exactly one winner. */
  async consume(grantId: string, at: number): Promise<boolean> {
    const result = this.sqlite
      .prepare(
        `UPDATE auth_pairing_grants SET consumed_at = ?
           WHERE grant_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .run(at, grantId, at);
    return result.changes === 1;
  }

  async incrementAttempts(grantId: string): Promise<number> {
    this.sqlite
      .prepare(`UPDATE auth_pairing_grants SET attempts = attempts + 1 WHERE grant_id = ?`)
      .run(grantId);
    const row = this.sqlite
      .prepare(`SELECT attempts FROM auth_pairing_grants WHERE grant_id = ?`)
      .get(grantId) as { attempts: number } | undefined;
    return row?.attempts ?? 0;
  }

  async revoke(grantId: string, at: number): Promise<void> {
    this.sqlite
      .prepare(`UPDATE auth_pairing_grants SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL`)
      .run(at, grantId);
  }

  /**
   * Pending-device coalescing: reopening the pairing dialog for the same
   * device invalidates whatever was shown before, so a leaked QR screenshot
   * stops working the moment a new one is generated.
   */
  async revokePendingFor(deviceNameHint: string, at: number): Promise<void> {
    this.sqlite
      .prepare(
        `UPDATE auth_pairing_grants SET revoked_at = ?
           WHERE device_name_hint = ? AND consumed_at IS NULL AND revoked_at IS NULL`,
      )
      .run(at, deviceNameHint);
  }

  async listPending(now: number): Promise<PairingGrantRecord[]> {
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM auth_pairing_grants
           WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
           ORDER BY created_at DESC`,
      )
      .all(now) as PairingRow[];
    return rows.map(toGrant);
  }

  async deleteExpired(before: number): Promise<number> {
    return this.sqlite
      .prepare(`DELETE FROM auth_pairing_grants WHERE expires_at < ?`)
      .run(before).changes;
  }
}

// ── Replay + nonce ───────────────────────────────────────────────

export class SqliteReplayStore implements IReplayStore {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase) {
    this.sqlite = sqliteHandle(db);
  }

  /**
   * The PRIMARY KEY is the duplicate barrier — `INSERT OR IGNORE` returning
   * 0 changes means the jti was already used. Never a read-then-write.
   */
  async register(jtiHash: string, expiresAt: number): Promise<boolean> {
    const now = Date.now();
    // Opportunistically clear an expired row for the same key so a legitimate
    // client can reuse a jti after the acceptance window has passed.
    this.sqlite
      .prepare(`DELETE FROM auth_replay_entries WHERE jti_hash = ? AND expires_at <= ?`)
      .run(jtiHash, now);
    const result = this.sqlite
      .prepare(`INSERT OR IGNORE INTO auth_replay_entries (jti_hash, expires_at) VALUES (?, ?)`)
      .run(jtiHash, expiresAt);
    return result.changes === 1;
  }

  async purge(before: number): Promise<number> {
    return this.sqlite.prepare(`DELETE FROM auth_replay_entries WHERE expires_at <= ?`).run(before)
      .changes;
  }
}

export class SqliteNonceStore implements INonceStore {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(
    db: AppDatabase,
    private readonly randomToken: () => string,
  ) {
    this.sqlite = sqliteHandle(db);
  }

  async issue(expiresAt: number): Promise<string> {
    const nonce = this.randomToken();
    this.sqlite
      .prepare(`INSERT INTO auth_nonces (nonce, expires_at) VALUES (?, ?)`)
      .run(nonce, expiresAt);
    return nonce;
  }

  /** Single-use: the DELETE is the consume, so a replayed nonce fails. */
  async verify(nonce: string, now: number): Promise<boolean> {
    const result = this.sqlite
      .prepare(`DELETE FROM auth_nonces WHERE nonce = ? AND expires_at > ?`)
      .run(nonce, now);
    return result.changes === 1;
  }

  async purge(before: number): Promise<number> {
    return this.sqlite.prepare(`DELETE FROM auth_nonces WHERE expires_at <= ?`).run(before).changes;
  }
}

// ── Stream tickets ───────────────────────────────────────────────

export class SqliteStreamTicketRepository implements IStreamTicketRepository {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase) {
    this.sqlite = sqliteHandle(db);
  }

  async create(ticket: StreamTicketRecord): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO auth_stream_tickets
           (ticket_hash, principal_id, principal_type, device_id, scopes, scope, scope_id,
            created_at, expires_at, consumed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        ticket.ticketHash,
        ticket.principalId,
        ticket.principalType,
        ticket.deviceId,
        JSON.stringify(ticket.scopes),
        ticket.scope,
        ticket.scopeId,
        ticket.createdAt,
        ticket.expiresAt,
        ticket.consumedAt,
      );
  }

  /** Atomic consume-and-return. A second reader gets null. */
  async consume(ticketHash: string, now: number): Promise<StreamTicketRecord | null> {
    const consumeAndRead = this.sqlite.transaction((hash: string, at: number) => {
      const updated = this.sqlite
        .prepare(
          `UPDATE auth_stream_tickets SET consumed_at = ?
             WHERE ticket_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
        )
        .run(at, hash, at);
      if (updated.changes !== 1) return null;
      return this.sqlite.prepare(`SELECT * FROM auth_stream_tickets WHERE ticket_hash = ?`).get(hash);
    });
    const row = consumeAndRead(ticketHash, now) as
      | {
          ticket_hash: string;
          principal_id: string;
          principal_type: string;
          device_id: string | null;
          scopes: string;
          scope: string;
          scope_id: string | null;
          created_at: number;
          expires_at: number;
          consumed_at: number | null;
        }
      | null
      | undefined;
    if (!row) return null;
    return {
      ticketHash: row.ticket_hash,
      principalId: row.principal_id,
      principalType: row.principal_type,
      deviceId: row.device_id,
      scopes: parseScopes(row.scopes),
      scope: row.scope,
      scopeId: row.scope_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
    };
  }

  async purge(before: number): Promise<number> {
    return this.sqlite.prepare(`DELETE FROM auth_stream_tickets WHERE expires_at <= ?`).run(before)
      .changes;
  }
}

// ── Service accounts ─────────────────────────────────────────────

export class SqliteServiceAccountRepository implements IServiceAccountRepository {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase) {
    this.sqlite = sqliteHandle(db);
  }

  async create(account: ServiceAccountRecord): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO auth_service_accounts
           (account_id, name, secret_hash, scopes, created_at, last_used_at, revoked_at, legacy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        account.accountId,
        account.name,
        account.secretHash,
        JSON.stringify(account.scopes),
        account.createdAt,
        account.lastUsedAt,
        account.revokedAt,
        account.legacy ? 1 : 0,
      );
  }

  async rotateSecret(accountId: string, secretHash: string): Promise<boolean> {
    const result = this.sqlite
      .prepare(
        `UPDATE auth_service_accounts
            SET secret_hash = ?, revoked_at = NULL
          WHERE account_id = ?`,
      )
      .run(secretHash, accountId);
    return result.changes > 0;
  }

  async findByHash(secretHash: string): Promise<ServiceAccountRecord | null> {
    const row = this.sqlite
      .prepare(`SELECT * FROM auth_service_accounts WHERE secret_hash = ?`)
      .get(secretHash) as
      | {
          account_id: string;
          name: string;
          secret_hash: string;
          scopes: string;
          created_at: number;
          last_used_at: number | null;
          revoked_at: number | null;
          legacy: number;
        }
      | undefined;
    if (!row) return null;
    return {
      accountId: row.account_id,
      name: row.name,
      secretHash: row.secret_hash,
      scopes: parseScopes(row.scopes),
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
      legacy: row.legacy === 1,
    };
  }

  async list(): Promise<ServiceAccountRecord[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM auth_service_accounts ORDER BY created_at DESC`)
      .all() as Array<Record<string, never>>;
    return rows.map((row) => ({
      accountId: row['account_id'] as unknown as string,
      name: row['name'] as unknown as string,
      // The hash is intentionally included: it is not a credential.
      secretHash: row['secret_hash'] as unknown as string,
      scopes: parseScopes(row['scopes'] as unknown as string),
      createdAt: row['created_at'] as unknown as number,
      lastUsedAt: (row['last_used_at'] ?? null) as unknown as number | null,
      revokedAt: (row['revoked_at'] ?? null) as unknown as number | null,
      legacy: (row['legacy'] as unknown as number) === 1,
    }));
  }

  async revoke(accountId: string, at: number): Promise<void> {
    this.sqlite
      .prepare(`UPDATE auth_service_accounts SET revoked_at = ? WHERE account_id = ?`)
      .run(at, accountId);
  }

  async markUsed(accountId: string, at: number): Promise<void> {
    this.sqlite
      .prepare(`UPDATE auth_service_accounts SET last_used_at = ? WHERE account_id = ?`)
      .run(at, accountId);
  }
}

// ── Audit ────────────────────────────────────────────────────────

export class SqliteSecurityAuditRepository implements ISecurityAuditRepository {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase) {
    this.sqlite = sqliteHandle(db);
  }

  async append(event: SecurityAuditEventRecord): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO security_audit_events (
           event_id, timestamp, actor_principal_type, actor_principal_id, actor_device_id,
           action, resource_type, resource_id, result, reason_code, request_id, connection_id,
           transport, source_address_hash, metadata, severity
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        event.eventId,
        event.timestamp,
        event.actorPrincipalType,
        event.actorPrincipalId,
        event.actorDeviceId,
        event.action,
        event.resourceType,
        event.resourceId,
        event.result,
        event.reasonCode,
        event.requestId,
        event.connectionId,
        event.transport,
        event.sourceAddressHash,
        event.metadata,
        event.severity,
      );
  }

  async list(filter?: {
    limit?: number;
    since?: number;
    action?: string;
    deviceId?: string;
    result?: AuditResult;
  }): Promise<SecurityAuditEventRecord[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (filter?.since != null) {
      clauses.push('timestamp >= ?');
      values.push(filter.since);
    }
    if (filter?.action) {
      clauses.push('action = ?');
      values.push(filter.action);
    }
    if (filter?.deviceId) {
      clauses.push('actor_device_id = ?');
      values.push(filter.deviceId);
    }
    if (filter?.result) {
      clauses.push('result = ?');
      values.push(filter.result);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filter?.limit ?? 200, 1), 2000);
    const rows = this.sqlite
      .prepare(`SELECT * FROM security_audit_events ${where} ORDER BY timestamp DESC LIMIT ?`)
      .all(...(values as never[]), limit) as Array<Record<string, never>>;
    return rows.map((row) => ({
      eventId: row['event_id'] as unknown as string,
      timestamp: row['timestamp'] as unknown as number,
      actorPrincipalType: row['actor_principal_type'] as unknown as string,
      actorPrincipalId: row['actor_principal_id'] as unknown as string,
      actorDeviceId: (row['actor_device_id'] ?? null) as unknown as string | null,
      action: row['action'] as unknown as string,
      resourceType: (row['resource_type'] ?? null) as unknown as string | null,
      resourceId: (row['resource_id'] ?? null) as unknown as string | null,
      result: row['result'] as unknown as AuditResult,
      reasonCode: (row['reason_code'] ?? null) as unknown as string | null,
      requestId: (row['request_id'] ?? null) as unknown as string | null,
      connectionId: (row['connection_id'] ?? null) as unknown as string | null,
      transport: (row['transport'] ?? null) as unknown as string | null,
      sourceAddressHash: (row['source_address_hash'] ?? null) as unknown as string | null,
      metadata: (row['metadata'] ?? null) as unknown as string | null,
      severity: row['severity'] as unknown as 'info' | 'warn' | 'critical',
    }));
  }

  async purge(before: number): Promise<number> {
    return this.sqlite.prepare(`DELETE FROM security_audit_events WHERE timestamp < ?`).run(before)
      .changes;
  }
}

// ── Relay revoke outbox ──────────────────────────────────────────

export class SqliteRelayRevokeOutboxRepository implements IRelayRevokeOutboxRepository {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase) {
    this.sqlite = sqliteHandle(db);
  }

  async enqueue(record: RelayRevokeOutboxRecord): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO relay_revoke_outbox
           (id, relay_binding, device_id, enqueued_at, attempts, last_attempt_at, last_error)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        record.id,
        record.relayBinding,
        record.deviceId,
        record.enqueuedAt,
        record.attempts,
        record.lastAttemptAt,
        record.lastError,
      );
  }

  async listPending(limit: number): Promise<RelayRevokeOutboxRecord[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM relay_revoke_outbox ORDER BY enqueued_at ASC LIMIT ?`)
      .all(Math.min(Math.max(limit, 1), 500)) as Array<Record<string, never>>;
    return rows.map((row) => ({
      id: row['id'] as unknown as string,
      relayBinding: row['relay_binding'] as unknown as string,
      deviceId: row['device_id'] as unknown as string,
      enqueuedAt: row['enqueued_at'] as unknown as number,
      attempts: row['attempts'] as unknown as number,
      lastAttemptAt: (row['last_attempt_at'] ?? null) as unknown as number | null,
      lastError: (row['last_error'] ?? null) as unknown as string | null,
    }));
  }

  async markAttempt(id: string, at: number, error: string | null): Promise<void> {
    this.sqlite
      .prepare(
        `UPDATE relay_revoke_outbox
           SET attempts = attempts + 1, last_attempt_at = ?, last_error = ? WHERE id = ?`,
      )
      .run(at, error, id);
  }

  /** Only called after the relay ACKs — otherwise the revocation is retried. */
  async remove(id: string): Promise<void> {
    this.sqlite.prepare(`DELETE FROM relay_revoke_outbox WHERE id = ?`).run(id);
  }
}

// ── Device scope requests (migration v52) ────────────────────────

interface ScopeRequestRow {
  id: string;
  device_id: string;
  requested_scopes: string;
  reason: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  resolution_note: string | null;
  granted_scopes: string | null;
}

function toScopeRequest(row: ScopeRequestRow): DeviceScopeRequestRecord {
  return {
    requestId: row.id,
    deviceId: row.device_id,
    requestedScopes: parseScopes(row.requested_scopes),
    reason: row.reason,
    status: row.status as DeviceScopeRequestStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionNote: row.resolution_note,
    grantedScopes: row.granted_scopes == null ? null : parseScopes(row.granted_scopes),
  };
}

export class SqliteDeviceScopeRequestRepository implements IDeviceScopeRequestRepository {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase) {
    this.sqlite = sqliteHandle(db);
  }

  /**
   * Throws on a second pending request for the same device — the partial
   * unique index is the authority, not a read-then-write in the service.
   */
  async create(record: DeviceScopeRequestRecord): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO device_scope_requests (
           id, device_id, requested_scopes, reason, status, created_at,
           resolved_at, resolved_by, resolution_note, granted_scopes
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        record.requestId,
        record.deviceId,
        JSON.stringify(record.requestedScopes),
        record.reason,
        record.status,
        record.createdAt,
        record.resolvedAt,
        record.resolvedBy,
        record.resolutionNote,
        record.grantedScopes == null ? null : JSON.stringify(record.grantedScopes),
      );
  }

  async get(requestId: string): Promise<DeviceScopeRequestRecord | null> {
    const row = this.sqlite
      .prepare('SELECT * FROM device_scope_requests WHERE id = ?')
      .get(requestId) as ScopeRequestRow | undefined;
    return row ? toScopeRequest(row) : null;
  }

  async findPendingByDevice(deviceId: string): Promise<DeviceScopeRequestRecord | null> {
    const row = this.sqlite
      .prepare(`SELECT * FROM device_scope_requests WHERE device_id = ? AND status = 'pending'`)
      .get(deviceId) as ScopeRequestRow | undefined;
    return row ? toScopeRequest(row) : null;
  }

  async listPending(): Promise<DeviceScopeRequestRecord[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM device_scope_requests WHERE status = 'pending' ORDER BY created_at ASC`)
      .all() as ScopeRequestRow[];
    return rows.map(toScopeRequest);
  }

  async listByDevice(deviceId: string, limit = 20): Promise<DeviceScopeRequestRecord[]> {
    const rows = this.sqlite
      .prepare(
        'SELECT * FROM device_scope_requests WHERE device_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      )
      .all(deviceId, Math.max(1, Math.min(limit, 200))) as ScopeRequestRow[];
    return rows.map(toScopeRequest);
  }

  /** Compare-and-set on `status = 'pending'` — see the port for why. */
  async resolve(
    requestId: string,
    patch: Parameters<IDeviceScopeRequestRepository['resolve']>[1],
  ): Promise<boolean> {
    const result = this.sqlite
      .prepare(
        `UPDATE device_scope_requests
            SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?, granted_scopes = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .run(
        patch.status,
        patch.resolvedAt,
        patch.resolvedBy,
        patch.resolutionNote,
        patch.grantedScopes == null ? null : JSON.stringify(patch.grantedScopes),
        requestId,
      );
    return result.changes > 0;
  }
}

// ────────────────────────────────────────────────────────────────
// Migration v52 + SqliteDeviceScopeRequestRepository.
//
// The two invariants the service leans on live in the ENGINE, not the
// service: one pending request per device (partial unique index) and an
// atomic pending→terminal transition (`UPDATE … WHERE status = 'pending'`).
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { DeviceRecord, DeviceScopeRequestRecord } from '@generatorai/auth';

import { createDB, type AppDatabase } from '../index.js';
import { migrateDB } from '../migrations/index.js';
import {
  SqliteDeviceRepository,
  SqliteDeviceScopeRequestRepository,
} from '../repositories/AuthRepositories.js';

function rawClient(db: AppDatabase): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

function device(deviceId: string): DeviceRecord {
  return {
    deviceId,
    ownerId: 'local',
    name: `Device ${deviceId}`,
    platform: 'mobile',
    publicJwk: '{}',
    jwkThumbprint: `tp-${deviceId}`,
    scopes: ['read:status'],
    createdAt: 1,
    lastSeenAt: null,
    lastSeenTransport: null,
    revokedAt: null,
    revokedReason: null,
    credentialVersion: 1,
    previousCredentialGraceUntil: null,
    connectionMode: 'auto',
    relayBinding: null,
  };
}

function request(requestId: string, deviceId: string, createdAt: number): DeviceScopeRequestRecord {
  return {
    requestId,
    deviceId,
    requestedScopes: ['exec:terminal', 'write:files'],
    reason: 'because',
    status: 'pending',
    createdAt,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    grantedScopes: null,
  };
}

let dir: string;
let db: AppDatabase;
let devices: SqliteDeviceRepository;
let repo: SqliteDeviceScopeRequestRepository;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gai-scope-requests-'));
  db = createDB(join(dir, 'd.db'));
  migrateDB(db);
  devices = new SqliteDeviceRepository(db);
  repo = new SqliteDeviceScopeRequestRepository(db);
  await devices.create(device('phone'));
  await devices.create(device('tablet'));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

describe('migration v52 — device_scope_requests', () => {
  it('creates the table, records the version, and is safe to re-run', () => {
    const sqlite = rawClient(db);
    const versions = sqlite
      .prepare('SELECT version, name FROM _schema_versions WHERE version = 52')
      .all() as Array<{ version: number; name: string }>;
    expect(versions).toEqual([{ version: 52, name: 'device_scope_requests' }]);

    const columns = (sqlite.pragma('table_info(device_scope_requests)') as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(columns).toEqual([
      'id', 'device_id', 'requested_scopes', 'reason', 'status', 'created_at',
      'resolved_at', 'resolved_by', 'resolution_note', 'granted_scopes',
    ]);

    // Existing-database path: roll the version back and migrate again.
    sqlite.prepare('DELETE FROM _schema_versions WHERE version = 52').run();
    expect(() => migrateDB(db)).not.toThrow();
  });
});

describe('SqliteDeviceScopeRequestRepository', () => {
  it('round-trips a record', async () => {
    await repo.create(request('r1', 'phone', 10));
    expect(await repo.get('r1')).toEqual(request('r1', 'phone', 10));
    expect(await repo.get('missing')).toBeNull();
  });

  it('enforces one PENDING request per device in the engine', async () => {
    await repo.create(request('r1', 'phone', 10));
    await expect(repo.create(request('r2', 'phone', 11))).rejects.toThrow(/UNIQUE/);
    // A different device is unaffected.
    await repo.create(request('r3', 'tablet', 12));
    expect((await repo.listPending()).map((r) => r.requestId)).toEqual(['r1', 'r3']);
  });

  it('resolves exactly once (compare-and-set on pending) and frees the slot', async () => {
    await repo.create(request('r1', 'phone', 10));
    const patch = {
      status: 'approved' as const,
      resolvedAt: 20,
      resolvedBy: 'local-desktop:local',
      resolutionNote: null,
      grantedScopes: ['exec:terminal'] as DeviceScopeRequestRecord['requestedScopes'],
    };
    expect(await repo.resolve('r1', patch)).toBe(true);
    expect(await repo.resolve('r1', { ...patch, status: 'denied', grantedScopes: null })).toBe(false);
    expect(await repo.resolve('missing', patch)).toBe(false);

    const stored = await repo.get('r1');
    expect(stored).toMatchObject({
      status: 'approved',
      resolvedAt: 20,
      resolvedBy: 'local-desktop:local',
      grantedScopes: ['exec:terminal'],
    });
    expect(await repo.findPendingByDevice('phone')).toBeNull();

    // The device can ask again once the previous request is closed.
    await repo.create(request('r2', 'phone', 30));
    expect((await repo.findPendingByDevice('phone'))?.requestId).toBe('r2');
  });

  it('lists a device history newest first, bounded', async () => {
    await repo.create(request('r1', 'phone', 10));
    await repo.resolve('r1', {
      status: 'cancelled',
      resolvedAt: 11,
      resolvedBy: 'paired-device:phone',
      resolutionNote: null,
      grantedScopes: null,
    });
    await repo.create(request('r2', 'phone', 20));
    await repo.create(request('r3', 'tablet', 30));

    expect((await repo.listByDevice('phone')).map((r) => [r.requestId, r.status])).toEqual([
      ['r2', 'pending'],
      ['r1', 'cancelled'],
    ]);
    expect((await repo.listByDevice('phone', 1)).map((r) => r.requestId)).toEqual(['r2']);
    expect((await repo.listPending()).map((r) => r.requestId)).toEqual(['r2', 'r3']);
  });

  it('rejects the CHECK constraint on an unknown status', async () => {
    await expect(
      repo.create({ ...request('r1', 'phone', 10), status: 'weird' as DeviceScopeRequestRecord['status'] }),
    ).rejects.toThrow(/CHECK/);
  });
});

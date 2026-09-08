// ────────────────────────────────────────────────────────────────
// Resume-credential rotation — the storage half of the grace window.
//
// `DeviceService` has always had a documented ten-minute grace window so a
// client that receives a rotated secret but is killed before persisting it
// can recover with the one it still holds. The service's own unit test
// proved that behaviour against a FAKE repository — while the real SQLite
// one revoked a credential the moment it was used, which made the grace
// branch unreachable and turned one interrupted rotation into a permanent
// lockout ("Access revoked", re-pair from the host).
//
// These tests pin the storage contract the service relies on, so the fake
// and the implementation cannot drift apart again.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { createDB, migrateDB, SqliteDeviceRepository } from '../src/index.js';

function credential(id: string, deviceId: string, version: number, now: number) {
  return {
    credentialId: id,
    deviceId,
    secretHash: `hash-${id}`,
    version,
    createdAt: now,
    expiresAt: now + 60_000,
    lastUsedAt: null,
    revokedAt: null,
  };
}

describe('SqliteDeviceRepository — credential rotation', () => {
  let db: ReturnType<typeof createDB>;
  let repo: SqliteDeviceRepository;
  const now = 1_700_000_000_000;
  const deviceId = 'device-1';

  beforeEach(async () => {
    db = createDB(':memory:');
    migrateDB(db);
    repo = new SqliteDeviceRepository(db);
    await repo.create({
      deviceId,
      ownerId: 'owner-1',
      name: 'Phone',
      platform: 'mobile',
      publicJwk: JSON.stringify({ kty: 'EC' }),
      jwkThumbprint: 'thumb-1',
      scopes: ['read:chats'],
      createdAt: now,
      lastSeenAt: now,
      lastSeenTransport: null,
      revokedAt: null,
      revokedReason: null,
      credentialVersion: 1,
      previousCredentialGraceUntil: null,
      connectionMode: 'direct',
      relayBinding: null,
    } as never);
  });

  it('records consumption without revoking — the grace window depends on it', async () => {
    await repo.createCredential(credential('cred-1', deviceId, 1, now));

    await repo.markCredentialUsed('cred-1', now + 1_000);

    const found = await repo.findCredentialByHash('hash-cred-1');
    expect(found).not.toBeNull();
    expect(found?.lastUsedAt).toBe(now + 1_000);
    // The one that matters: a consumed credential is still *findable and
    // unrevoked*, so `refreshSession` reaches its generation check instead of
    // rejecting it as INVALID_GRANT before the grace window is consulted.
    expect(found?.revokedAt).toBeNull();
  });

  it('still revokes deliberately, so unpair and device-revoke keep working', async () => {
    await repo.createCredential(credential('cred-1', deviceId, 1, now));
    await repo.createCredential(credential('cred-2', deviceId, 2, now));

    await repo.revokeCredentials(deviceId, now + 5_000);

    expect((await repo.findCredentialByHash('hash-cred-1'))?.revokedAt).toBe(now + 5_000);
    expect((await repo.findCredentialByHash('hash-cred-2'))?.revokedAt).toBe(now + 5_000);
  });

  it('keeps one credential alive when revoking all but the newest', async () => {
    await repo.createCredential(credential('cred-1', deviceId, 1, now));
    await repo.createCredential(credential('cred-2', deviceId, 2, now));

    await repo.revokeCredentials(deviceId, now + 5_000, 'cred-2');

    expect((await repo.findCredentialByHash('hash-cred-1'))?.revokedAt).toBe(now + 5_000);
    expect((await repo.findCredentialByHash('hash-cred-2'))?.revokedAt).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// Device scope requests end to end (mobile standalone plan S2).
//
// Real routes, real DeviceService, real SQLite repositories and a real
// audit log over a fresh database — the way composition/security.ts wires
// them — with only the auth middleware replaced by a principal injected per
// request. Scope enforcement is still the REAL policy table: a tiny
// middleware below applies `requiredScopesFor` exactly as
// middleware/auth.ts does, so "a non-admin cannot list or approve" is proved
// against the same rules production uses, not against a stub.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import {
  DEFAULT_MOBILE_SCOPES,
  DeviceService,
  SecurityAuditService,
  STANDALONE_MOBILE_SCOPES,
  hasAllScopes,
  requiredScopesFor,
  type DeviceRecord,
  type Principal,
} from '@generatorai/auth';
import {
  createDB,
  migrateDB,
  SqliteDeviceRepository,
  SqliteDeviceScopeRequestRepository,
  SqliteSecurityAuditRepository,
  type AppDatabase,
} from '@generatorai/db';

import { createScopeRequestRoutes } from '../routes/scopeRequests.js';

// ── Fixture ────────────────────────────────────────────────────────

function device(deviceId: string, name: string, scopes: readonly string[]): DeviceRecord {
  return {
    deviceId,
    ownerId: 'local',
    name,
    platform: 'mobile',
    publicJwk: '{}',
    jwkThumbprint: `tp-${deviceId}`,
    scopes: [...scopes] as DeviceRecord['scopes'],
    createdAt: Date.now(),
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

const PHONE = device('phone', 'Sid’s phone', DEFAULT_MOBILE_SCOPES);
const OTHER = device('other', 'Other phone', DEFAULT_MOBILE_SCOPES);

const PHONE_PRINCIPAL: Principal = {
  type: 'paired-device',
  id: PHONE.deviceId,
  deviceId: PHONE.deviceId,
  displayName: PHONE.name,
  scopes: PHONE.scopes,
  transport: 'lan',
};
const OTHER_PRINCIPAL: Principal = { ...PHONE_PRINCIPAL, id: OTHER.deviceId, deviceId: OTHER.deviceId, displayName: OTHER.name };
const ADMIN_PRINCIPAL: Principal = {
  type: 'local-desktop',
  id: 'local',
  displayName: 'Desktop',
  scopes: [...STANDALONE_MOBILE_SCOPES, 'admin:devices', 'admin:settings'],
  transport: 'loopback',
};

let dir: string;
let db: AppDatabase;
let deviceRepo: SqliteDeviceRepository;
let auditRepo: SqliteSecurityAuditRepository;
let audit: SecurityAuditService;
let emitGlobal: ReturnType<typeof vi.fn>;
let app: express.Express;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gai-scope-req-routes-'));
  db = createDB(join(dir, 'd.db'));
  migrateDB(db);
  deviceRepo = new SqliteDeviceRepository(db);
  auditRepo = new SqliteSecurityAuditRepository(db);
  await deviceRepo.create(PHONE);
  await deviceRepo.create(OTHER);

  audit = new SecurityAuditService(auditRepo);
  const devices = new DeviceService({
    devices: deviceRepo,
    pairing: {} as never,
    tokens: {} as never,
    audit,
    scopeRequests: new SqliteDeviceScopeRequestRepository(db),
  });
  emitGlobal = vi.fn(async () => undefined);

  const container = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    eventBus: { emitGlobal },
    security: { devices, audit },
  };

  app = express();
  app.use(express.json());
  // Principal comes from a header; the policy check is the real table.
  app.use((req, res, next) => {
    const raw = req.header('x-test-principal');
    if (!raw) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      return;
    }
    // Base64: a device name may carry non-ASCII, which a raw header cannot.
    const principal = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Principal;
    const apiPath = req.originalUrl.replace(/^\/api/, '').split('?')[0]!;
    const { scopes } = requiredScopesFor(req.method, apiPath);
    if (!hasAllScopes(principal.scopes, scopes)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', requiredScopes: scopes } });
      return;
    }
    (req as unknown as { principal: Principal }).principal = principal;
    (req as unknown as { requestId: string }).requestId = 'req-test';
    next();
  });
  app.use('/api/auth', createScopeRequestRoutes(container as never));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

const as = (principal: Principal) => ({
  'x-test-principal': Buffer.from(JSON.stringify(principal), 'utf8').toString('base64'),
});

async function auditActions(): Promise<Array<{ action: string; severity: string; metadata: unknown }>> {
  await audit.flush();
  return (await auditRepo.list({ limit: 100 })).map((e) => ({
    action: e.action,
    severity: e.severity,
    metadata: e.metadata ? JSON.parse(e.metadata) : null,
  }));
}

// ── Tests ──────────────────────────────────────────────────────────

describe('scope requests — happy path', () => {
  it('device asks → admin lists → approves a subset → device scopes + audit updated', async () => {
    const created = await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['exec:terminal', 'exec:browser', 'write:files'], reason: 'deploy from the train' })
      .expect(201);
    expect(created.body).toMatchObject({
      deviceId: 'phone',
      deviceName: PHONE.name,
      platform: 'mobile',
      scopes: ['exec:browser', 'exec:terminal', 'write:files'],
      reason: 'deploy from the train',
      status: 'pending',
      grantedScopes: null,
    });
    const requestId = created.body.requestId as string;
    expect(emitGlobal).toHaveBeenCalledWith({
      kind: 'device.scope_requested',
      data: {
        requestId,
        deviceId: 'phone',
        deviceName: PHONE.name,
        platform: 'mobile',
        scopes: ['exec:browser', 'exec:terminal', 'write:files'],
      },
    });

    const mine = await request(app)
      .get('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .expect(200);
    expect(mine.body.requests.map((r: { requestId: string; status: string }) => [r.requestId, r.status])).toEqual([
      [requestId, 'pending'],
    ]);

    const queue = await request(app)
      .get('/api/auth/scope-requests?status=pending')
      .set(as(ADMIN_PRINCIPAL))
      .expect(200);
    expect(queue.body.requests).toHaveLength(1);
    expect(queue.body.requests[0]).toMatchObject({ requestId, deviceName: PHONE.name });

    const approved = await request(app)
      .post(`/api/auth/scope-requests/${requestId}/approve`)
      .set(as(ADMIN_PRINCIPAL))
      .send({ scopes: ['exec:terminal', 'write:files'] })
      .expect(200);
    expect(approved.body.request).toMatchObject({
      status: 'approved',
      grantedScopes: ['exec:terminal', 'write:files'],
      resolvedBy: 'local-desktop:local',
    });
    expect(approved.body.deviceScopes).toContain('exec:terminal');
    expect(approved.body.deviceScopes).not.toContain('exec:browser');

    const stored = await deviceRepo.findById('phone');
    expect(stored?.scopes).toContain('exec:terminal');
    expect(stored?.scopes).toContain('write:files');
    expect(stored?.scopes).not.toContain('exec:browser');
    for (const scope of DEFAULT_MOBILE_SCOPES) expect(stored?.scopes).toContain(scope);

    expect(emitGlobal).toHaveBeenLastCalledWith({
      kind: 'device.scope_request_resolved',
      data: {
        requestId,
        deviceId: 'phone',
        deviceName: PHONE.name,
        status: 'approved',
        scopes: ['exec:terminal', 'write:files'],
      },
    });

    const actions = await auditActions();
    expect(actions.find((a) => a.action === 'device.scope_requested')).toMatchObject({
      severity: 'warn',
      metadata: { deviceId: 'phone', scopes: ['exec:browser', 'exec:terminal', 'write:files'] },
    });
    expect(
      actions.find((a) => a.action === 'device.scopes_changed' && a.severity === 'critical'),
    ).toMatchObject({ metadata: { highRiskGranted: ['exec:terminal'], scopeRequestId: requestId } });
    expect(actions.find((a) => a.action === 'device.scope_request_resolved')).toMatchObject({
      severity: 'critical',
      metadata: { granted: ['exec:terminal', 'write:files'] },
    });

    // The queue is empty and the device can ask again.
    const after = await request(app).get('/api/auth/scope-requests').set(as(ADMIN_PRINCIPAL)).expect(200);
    expect(after.body.requests).toEqual([]);
  });

  it('deny records the note and leaves the device unchanged', async () => {
    const created = await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['exec:terminal'] })
      .expect(201);
    const denied = await request(app)
      .post(`/api/auth/scope-requests/${created.body.requestId}/deny`)
      .set(as(ADMIN_PRINCIPAL))
      .send({ note: 'not from a café' })
      .expect(200);
    expect(denied.body.request).toMatchObject({ status: 'denied', resolutionNote: 'not from a café', grantedScopes: null });
    expect((await deviceRepo.findById('phone'))?.scopes).toEqual(PHONE.scopes);
    expect(emitGlobal).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'device.scope_request_resolved', data: expect.objectContaining({ status: 'denied' }) }),
    );
    // Second answer is a conflict, not a second grant.
    await request(app)
      .post(`/api/auth/scope-requests/${created.body.requestId}/approve`)
      .set(as(ADMIN_PRINCIPAL))
      .send({})
      .expect(409)
      .expect((res) => expect(res.body.error.code).toBe('NOT_PENDING'));
  });

  it('cancel withdraws the device’s own request and frees the slot', async () => {
    const created = await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['exec:terminal'] })
      .expect(201);
    const id = created.body.requestId as string;

    // Another device cannot cancel it — and cannot learn that it exists.
    await request(app).delete(`/api/auth/devices/me/scope-requests/${id}`).set(as(OTHER_PRINCIPAL)).expect(404);

    await request(app).delete(`/api/auth/devices/me/scope-requests/${id}`).set(as(PHONE_PRINCIPAL)).expect(204);
    const mine = await request(app).get('/api/auth/devices/me/scope-requests').set(as(PHONE_PRINCIPAL)).expect(200);
    expect(mine.body.requests[0]).toMatchObject({ requestId: id, status: 'cancelled' });
    expect(emitGlobal).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'device.scope_request_resolved', data: expect.objectContaining({ status: 'cancelled' }) }),
    );

    await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['exec:browser'] })
      .expect(201);
  });
});

describe('scope requests — refusals', () => {
  it('a non-admin device cannot request admin:* (403 SCOPE_NOT_REQUESTABLE)', async () => {
    const res = await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['exec:terminal', 'admin:devices'] })
      .expect(403);
    expect(res.body.error.code).toBe('SCOPE_NOT_REQUESTABLE');
    expect(emitGlobal).not.toHaveBeenCalled();
    const actions = await auditActions();
    expect(actions.find((a) => a.action === 'device.scope_requested')).toMatchObject({ severity: 'warn' });
  });

  it('a second pending request is a 409 carrying the open one', async () => {
    const first = await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['exec:terminal'] })
      .expect(201);
    const dup = await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['exec:browser'] })
      .expect(409);
    expect(dup.body.error.code).toBe('REQUEST_PENDING');
    expect(dup.body.existing).toMatchObject({ requestId: first.body.requestId, status: 'pending' });
  });

  it('validates the body: unknown scope, already-held scope, empty list', async () => {
    await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['exec:root'] })
      .expect(400)
      .expect((res) => expect(res.body.error.code).toBe('UNKNOWN_SCOPE'));
    await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['read:chats'] })
      .expect(400)
      .expect((res) => expect(res.body.error.code).toBe('SCOPES_ALREADY_HELD'));
    await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: [] })
      .expect(400)
      .expect((res) => expect(res.body.error.code).toBe('INVALID_BODY'));
  });

  it('only a paired device can ask; the desktop principal is refused', async () => {
    await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(ADMIN_PRINCIPAL))
      .send({ scopes: ['exec:terminal'] })
      .expect(403)
      .expect((res) => expect(res.body.error.code).toBe('NOT_A_DEVICE'));
  });

  it('a non-admin device cannot list, approve or deny (real route policy)', async () => {
    const created = await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['exec:terminal'] })
      .expect(201);
    const id = created.body.requestId as string;
    for (const call of [
      request(app).get('/api/auth/scope-requests').set(as(OTHER_PRINCIPAL)),
      request(app).post(`/api/auth/scope-requests/${id}/approve`).set(as(OTHER_PRINCIPAL)).send({}),
      request(app).post(`/api/auth/scope-requests/${id}/deny`).set(as(OTHER_PRINCIPAL)).send({}),
      // Not even the requester can approve itself.
      request(app).post(`/api/auth/scope-requests/${id}/approve`).set(as(PHONE_PRINCIPAL)).send({}),
    ]) {
      const res = await call.expect(403);
      expect(res.body.error.requiredScopes).toEqual(['admin:devices']);
    }
    expect((await deviceRepo.findById('phone'))?.scopes).toEqual(PHONE.scopes);
  });

  it('an admin cannot grant beyond its own scopes, and the request stays pending', async () => {
    const created = await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['exec:terminal'] })
      .expect(201);
    const weakAdmin: Principal = { ...ADMIN_PRINCIPAL, scopes: [...DEFAULT_MOBILE_SCOPES, 'admin:devices'] };
    const res = await request(app)
      .post(`/api/auth/scope-requests/${created.body.requestId}/approve`)
      .set(as(weakAdmin))
      .send({})
      .expect(403);
    expect(res.body.error.code).toBe('SCOPE_ESCALATION');
    const queue = await request(app).get('/api/auth/scope-requests').set(as(ADMIN_PRINCIPAL)).expect(200);
    expect(queue.body.requests.map((r: { requestId: string }) => r.requestId)).toEqual([created.body.requestId]);
  });

  it('approving a scope that was not requested is a 400', async () => {
    const created = await request(app)
      .post('/api/auth/devices/me/scope-requests')
      .set(as(PHONE_PRINCIPAL))
      .send({ scopes: ['write:files'] })
      .expect(201);
    await request(app)
      .post(`/api/auth/scope-requests/${created.body.requestId}/approve`)
      .set(as(ADMIN_PRINCIPAL))
      .send({ scopes: ['exec:terminal'] })
      .expect(400)
      .expect((res) => expect(res.body.error.code).toBe('NOT_IN_REQUEST'));
    await request(app)
      .post('/api/auth/scope-requests/nope/approve')
      .set(as(ADMIN_PRINCIPAL))
      .send({})
      .expect(404);
  });
});

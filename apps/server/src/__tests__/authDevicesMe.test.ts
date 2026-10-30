// GET /api/auth/devices/me (mobile MG-01): a paired device reads its OWN
// record with only `read:status`. The id is the principal's, never the
// path's; a non-device session gets 404 NOT_A_DEVICE; key material, owner
// and relay binding never appear.

import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { DEFAULT_MOBILE_SCOPES, hasAllScopes, requiredScopesFor, type DeviceRecord, type Principal } from '@generatorai/auth';
import { createAuthRoutes } from '../routes/auth.js';

const DEVICE: DeviceRecord = {
  deviceId: 'phone-1',
  ownerId: 'local',
  name: 'Sid’s phone',
  platform: 'mobile',
  publicJwk: '{"kty":"EC"}',
  jwkThumbprint: 'tp',
  scopes: [...DEFAULT_MOBILE_SCOPES],
  createdAt: Date.parse('2026-09-01T00:00:00Z'),
  lastSeenAt: Date.parse('2026-10-01T00:00:00Z'),
  lastSeenTransport: 'lan',
  revokedAt: null,
  revokedReason: null,
  credentialVersion: 2,
  previousCredentialGraceUntil: null,
  connectionMode: 'auto',
  relayBinding: 'secret-binding',
  approvalPublicJwk: '{"kty":"EC","crv":"P-256"}',
  approvalKeyCreatedAt: Date.parse('2026-10-02T00:00:00Z'),
  approvalKeyPresence: 'biometry',
};

function makeApp(principal: Partial<Principal>) {
  const getDevice = vi.fn(async (id: string) => (id === DEVICE.deviceId ? DEVICE : null));
  const container = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: { port: 3100, security: { corsOrigins: [] } },
    security: { devices: { getDevice }, tokens: {}, dpop: {}, audit: {}, posture: {}, identity: {} },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const apiPath = req.originalUrl.replace(/^\/api/, '').split('?')[0]!;
    const { scopes } = requiredScopesFor(req.method, apiPath);
    if (!hasAllScopes(principal.scopes ?? [], scopes)) {
      res.status(403).json({ error: { code: 'FORBIDDEN' } });
      return;
    }
    (req as unknown as { principal: unknown }).principal = principal;
    next();
  });
  app.use('/api/auth', createAuthRoutes(container as never));
  return { app, getDevice };
}

describe('GET /api/auth/devices/me', () => {
  it('returns the calling device with a default mobile grant', async () => {
    const { app, getDevice } = makeApp({ type: 'paired-device', id: 'phone-1', scopes: [...DEFAULT_MOBILE_SCOPES] });
    const res = await request(app).get('/api/auth/devices/me');
    expect(res.status).toBe(200);
    expect(getDevice).toHaveBeenCalledWith('phone-1');
    expect(res.body).toEqual({
      deviceId: 'phone-1',
      name: 'Sid’s phone',
      platform: 'mobile',
      scopes: [...DEFAULT_MOBILE_SCOPES],
      createdAt: '2026-09-01T00:00:00.000Z',
      lastSeenAt: '2026-10-01T00:00:00.000Z',
      connectionMode: 'auto',
      credentialVersion: 2,
      approvalKey: { createdAt: '2026-10-02T00:00:00.000Z', presence: 'biometry' },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret-binding');
    expect(JSON.stringify(res.body)).not.toContain('kty');
  });

  it('answers 404 NOT_A_DEVICE for a session that is not a paired device', async () => {
    const { app } = makeApp({ type: 'local-desktop', id: 'local', scopes: ['read:status'] });
    const res = await request(app).get('/api/auth/devices/me');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_A_DEVICE');
  });

  it('still keeps other devices behind admin:devices', async () => {
    const { app } = makeApp({ type: 'paired-device', id: 'phone-1', scopes: [...DEFAULT_MOBILE_SCOPES] });
    expect((await request(app).get('/api/auth/devices/other')).status).toBe(403);
  });
});

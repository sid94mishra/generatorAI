// The mobile app revoked a device via `POST /api/auth/devices/:id/revoke`,
// which the server never registered (404). The canonical route is
// `DELETE /devices/:id`; both shapes now reach the same handler, and both sit
// under the `/auth/devices` policy prefix so the alias cannot be a cheaper
// path to the same action.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolveRoutePolicy } from '@generatorai/auth';
import { createAuthRoutes } from '../routes/auth.js';

const PRINCIPAL = {
  type: 'paired-device',
  id: 'admin-device',
  displayName: 'Admin',
  scopes: ['admin:devices'],
  transport: 'loopback',
};

function makeApp() {
  const revokeDevice = vi.fn(async () => undefined);
  const container = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: { port: 3100, security: { corsOrigins: [] } },
    security: {
      devices: { revokeDevice },
      tokens: { publicJwk: vi.fn(() => ({})) },
      dpop: {},
      audit: { record: vi.fn(async () => undefined), list: vi.fn(async () => []) },
      posture: { tokenAudience: 'generatorai', authenticationRequired: true, legacyApiKeyActive: false },
      identity: { hostId: 'host', publicKeyBase64Url: 'pk' },
    },
  };
  const app = express();
  app.use(express.json());
  // The real auth middleware runs ahead of these routes; here the principal
  // is injected directly so only the route table is under test.
  app.use((req, _res, next) => {
    (req as unknown as { principal: unknown }).principal = PRINCIPAL;
    next();
  });
  app.use('/api/auth', createAuthRoutes(container as never));
  return { app, revokeDevice };
}

describe('device revoke routes', () => {
  it('DELETE /devices/:id revokes with the body reason', async () => {
    const { app, revokeDevice } = makeApp();
    await request(app)
      .delete('/api/auth/devices/dev-1')
      .send({ reason: 'lost phone' })
      .expect(204);
    expect(revokeDevice).toHaveBeenCalledWith('dev-1', 'lost phone', PRINCIPAL);
  });

  it('POST /devices/:id/revoke is an alias for the same handler (was a 404)', async () => {
    const { app, revokeDevice } = makeApp();
    await request(app)
      .post('/api/auth/devices/dev-2/revoke')
      .send({ reason: 'Revoked from mobile' })
      .expect(204);
    expect(revokeDevice).toHaveBeenCalledWith('dev-2', 'Revoked from mobile', PRINCIPAL);
  });

  it('both shapes require the same admin:devices write scope', () => {
    const canonical = resolveRoutePolicy('/auth/devices/dev-1');
    const alias = resolveRoutePolicy('/auth/devices/dev-1/revoke');
    expect(alias.write).toEqual(canonical.write);
    expect(alias.write).toEqual(['admin:devices']);
  });
});

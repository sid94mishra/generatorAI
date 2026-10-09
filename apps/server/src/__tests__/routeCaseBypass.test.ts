// Audit F-1 (D-115) at the HTTP layer: the REAL auth middleware in front of
// the REAL /api/auth router. Express dispatches `/auth/Devices` to the
// `/auth/devices` handler, so a low-scope device must get the same 403 there
// that it gets on the lower-case path — not the device list.

import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_MCP_SCOPES, type Principal } from '@generatorai/auth';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createAuthRoutes } from '../routes/auth.js';

const MCP_DEVICE: Principal = {
  type: 'paired-device',
  id: 'mcp-device',
  displayName: 'Agent',
  scopes: [...DEFAULT_MCP_SCOPES],
  transport: 'loopback',
};

function makeApp(principal: Principal) {
  const revokeDevice = vi.fn(async () => undefined);
  const listDevices = vi.fn(async () => [
    { deviceId: 'other', name: 'Other', platform: 'web', scopes: [], createdAt: 1, credentialVersion: 1 },
  ]);
  const createPairingGrant = vi.fn();
  const container = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: { port: 3100, security: { corsOrigins: [] } },
    security: {
      devices: { revokeDevice, listDevices, createPairingGrant },
      tokens: { publicJwk: vi.fn(() => ({})) },
      dpop: {},
      audit: { record: vi.fn(async () => undefined), list: vi.fn(async () => [{ action: 'secret' }]) },
      posture: { tokenAudience: 'generatorai', authenticationRequired: true, legacyApiKeyActive: false },
      identity: { hostId: 'host', publicKeyBase64Url: 'pk' },
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createAuthMiddleware({
      auth: { authenticate: vi.fn(async () => principal) } as never,
      audit: { record: vi.fn() } as never,
      logger: container.logger as never,
    }),
  );
  app.use('/api/auth', createAuthRoutes(container as never));
  return { app, revokeDevice, listDevices, createPairingGrant };
}

describe('route policy is enforced on every spelling the router accepts (F-1)', () => {
  it('GET /api/auth/Devices → 403 for a low-scope device (was 200 + the device list)', async () => {
    const { app, listDevices } = makeApp(MCP_DEVICE);
    const res = await request(app).get('/api/auth/Devices');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_SCOPE');
    expect(res.body.error.requiredScopes).toEqual(['admin:devices']);
    expect(listDevices).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/api/auth/DEVICES/'],
    ['get', '/api/AUTH/devices'],
    ['get', '/api/auth/Audit'],
    ['get', '/api/auth/%64evices'],
    ['post', '/api/auth/Pair'],
    ['delete', '/api/auth/Devices/other'],
    ['post', '/api/auth/devices/other/Revoke'],
  ] as const)('%s %s → 403', async (method, path) => {
    const { app, revokeDevice, listDevices, createPairingGrant } = makeApp(MCP_DEVICE);
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(403);
    expect(revokeDevice).not.toHaveBeenCalled();
    expect(listDevices).not.toHaveBeenCalled();
    expect(createPairingGrant).not.toHaveBeenCalled();
  });

  it('an admin still reaches the mixed-case spelling (only authority changed, not routing)', async () => {
    const { app, listDevices } = makeApp({ ...MCP_DEVICE, scopes: ['admin:devices'] });
    const res = await request(app).get('/api/auth/Devices');
    expect(res.status).toBe(200);
    expect(listDevices).toHaveBeenCalled();
  });

  // Raw requests: supertest (WHATWG URL) would normalise the dot segments away.
  function rawGet(app: express.Express, path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode ?? 0, body });
          });
        });
        req.on('error', (err) => {
          server.close();
          reject(err);
        });
        req.end();
      });
    });
  }

  it.each(['/api/auth/x/../devices', '/api/auth/x/%2e%2e/devices', '/api/auth//devices', '/api/chats/%zz'])(
    'a non-canonical path is refused before authentication: %s',
    async (path) => {
      const { app } = makeApp({ ...MCP_DEVICE, scopes: ['admin:devices'] });
      const res = await rawGet(app, path);
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('NON_CANONICAL_PATH');
    },
  );
});

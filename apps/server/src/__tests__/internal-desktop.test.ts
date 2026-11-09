// The desktop shell's pairing-grant mint. Loopback + per-launch token were
// already tested by inspection; what was missing — and is pinned here — is a
// rate limit: this prefix sits outside `/api` and used to have none, so a
// caller past the shell could mint all-scope grants without bound.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createInternalDesktopRoutes, INTERNAL_DESKTOP_RATE_LIMIT } from '../routes/internal-desktop.js';
import { hostIdFromPublicKey } from '@generatorai/relay-protocol';
import { ALL_SCOPES } from '@generatorai/auth';

const TOKEN = 'desktop-admin-token';

// A canonical base64url-encoded 32-byte key, paired with the hostId the real
// derivation (`hostIdFromPublicKey`) produces for it. PairingOfferSchema's
// superRefine cross-checks `serverId === hostIdFromPublicKey(serverPublicKey)`
// and also round-trips `serverPublicKey` through decode/re-encode
// (`isCanonicalKey`) — two independent literals like 'A'.repeat(43) and
// 'B'.repeat(43) satisfy neither, so the route's PairingOfferSchema.parse()
// threw and every "enabled" case 500'd instead of exercising the route.
const PUBLIC_KEY = Buffer.alloc(32, 'B').toString('base64url');
const HOST_ID = hostIdFromPublicKey(Buffer.from(PUBLIC_KEY, 'base64url'));

function makeContainer() {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    localAdminToken: null,
    config: { port: 3100 },
    security: {
      identity: {
        hostId: HOST_ID,
        publicKeyBase64Url: PUBLIC_KEY,
      },
      devices: {
        createPairingGrant: vi.fn(async () => ({
          pairingToken: 'C'.repeat(43),
          expiresAt: Date.now() + 60_000,
          requestedScopes: ['chats:read'],
        })),
        getDevice: vi.fn(async (_id: string): Promise<Record<string, unknown> | null> => null),
        updateDeviceScopes: vi.fn(async () => []),
      },
    },
  };
}

function makeApp(container: ReturnType<typeof makeContainer>, rateLimit = INTERNAL_DESKTOP_RATE_LIMIT) {
  const app = express();
  app.use(express.json());
  app.use('/internal/desktop', createInternalDesktopRoutes(container as never, rateLimit));
  return app;
}

describe('internal desktop routes', () => {
  beforeEach(() => {
    process.env['GENERATORAI_DESKTOP_ADMIN_TOKEN'] = TOKEN;
  });
  afterEach(() => {
    delete process.env['GENERATORAI_DESKTOP_ADMIN_TOKEN'];
  });

  it('rejects a missing or wrong bearer token', async () => {
    const container = makeContainer();
    const app = makeApp(container);
    await request(app).post('/internal/desktop/pairing').send({}).expect(401);
    await request(app).post('/internal/desktop/pairing').set('authorization', 'Bearer nope').send({}).expect(401);
    expect(container.security.devices.createPairingGrant).not.toHaveBeenCalled();
  });

  it('mints a pairing offer for the shell', async () => {
    const container = makeContainer();
    const res = await request(makeApp(container))
      .post('/internal/desktop/pairing')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ deviceName: 'Desktop on test' })
      .expect(201);
    expect(res.body).toMatchObject({ pairingCode: expect.any(String), pairingUrl: expect.any(String) });
    expect(container.security.devices.createPairingGrant).toHaveBeenCalledWith(
      expect.objectContaining({ deviceNameHint: 'Desktop on test', platform: 'desktop' }),
    );
  });

  it('rate-limits the mint even for a correctly authenticated caller', async () => {
    const container = makeContainer();
    const app = makeApp(container, { perKeyLimit: 3, globalLimit: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/internal/desktop/pairing').set('authorization', `Bearer ${TOKEN}`).send({}).expect(201);
    }
    const refused = await request(app)
      .post('/internal/desktop/pairing')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({})
      .expect(429);
    expect(refused.headers['retry-after']).toBeDefined();
    expect(container.security.devices.createPairingGrant).toHaveBeenCalledTimes(3);
  });

  it('counts unauthenticated probes against the limit too (the limiter runs first)', async () => {
    const app = makeApp(makeContainer(), { perKeyLimit: 2, globalLimit: 2, windowMs: 60_000 });
    await request(app).post('/internal/desktop/pairing').send({}).expect(401);
    await request(app).post('/internal/desktop/pairing').send({}).expect(401);
    await request(app).post('/internal/desktop/pairing').send({}).expect(429);
  });

  it('tops the shell\'s own desktop device up to every scope', async () => {
    const container = makeContainer();
    const held = ALL_SCOPES.filter((s) => s !== 'exec:device');
    container.security.devices.getDevice.mockResolvedValue({ deviceId: 'd1', platform: 'desktop', revokedAt: null, scopes: held });
    const res = await request(makeApp(container))
      .post('/internal/desktop/scopes')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ deviceId: 'd1' })
      .expect(200);
    expect(res.body).toEqual({ added: ['exec:device'] });
    expect(container.security.devices.updateDeviceScopes).toHaveBeenCalledWith('d1', [...held, 'exec:device'], expect.objectContaining({ id: 'desktop-shell' }));
  });

  it('never widens a device that is not the shell\'s own desktop grant', async () => {
    for (const device of [
      { deviceId: 'd2', platform: 'mobile', revokedAt: null, scopes: ['admin:devices'] },
      { deviceId: 'd3', platform: 'desktop', revokedAt: null, scopes: ['read:chats'] },
      { deviceId: 'd4', platform: 'desktop', revokedAt: 1, scopes: ['admin:devices'] },
    ]) {
      const container = makeContainer();
      container.security.devices.getDevice.mockResolvedValue(device);
      await request(makeApp(container)).post('/internal/desktop/scopes').set('authorization', `Bearer ${TOKEN}`).send({ deviceId: device.deviceId }).expect(404);
      expect(container.security.devices.updateDeviceScopes).not.toHaveBeenCalled();
    }
    await request(makeApp(makeContainer())).post('/internal/desktop/scopes').send({ deviceId: 'd1' }).expect(401);
  });

  it('ships with a small default budget', () => {
    expect(INTERNAL_DESKTOP_RATE_LIMIT.perKeyLimit).toBeLessThanOrEqual(10);
    expect(INTERNAL_DESKTOP_RATE_LIMIT.windowMs).toBe(60_000);
  });
});

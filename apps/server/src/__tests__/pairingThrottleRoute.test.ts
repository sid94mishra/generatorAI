// Audit F-3 (D-117) at the route: a throttled pairing call answers 429 with
// Retry-After and a message the UI can show as-is, and only a genuinely local
// request is marked as the trusted source.

import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PairingError } from '@generatorai/auth';
import { createAuthRoutes } from '../routes/auth.js';

function makeApp(preview: (params: Record<string, unknown>) => Promise<unknown>) {
  const previewPairingGrant = vi.fn(preview);
  const container = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: { port: 3100, security: { corsOrigins: [] } },
    security: {
      devices: { previewPairingGrant },
      tokens: { publicJwk: vi.fn(() => ({})) },
      dpop: {},
      audit: { record: vi.fn() },
      posture: { tokenAudience: 'generatorai', authenticationRequired: true, legacyApiKeyActive: false, bindHost: '127.0.0.1' },
      identity: { hostId: 'host', publicKeyBase64Url: 'pk' },
      tls: null,
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRoutes(container as never));
  return { app, previewPairingGrant };
}

describe('POST /api/auth/pair/preview throttling (F-3)', () => {
  it('answers 429 with Retry-After, the retry delay and whose budget ran out', async () => {
    const { app } = makeApp(async () => {
      throw new PairingError('Too many pairing attempts from this network address — try again in 42 s.', 'THROTTLED', {
        retryAfterMs: 42_000,
        limit: 'source',
      });
    });
    const res = await request(app).post('/api/auth/pair/preview').send({ pairingToken: 'ABCD-EFGH-JKMN' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('42');
    expect(res.body.error).toEqual({
      code: 'THROTTLED',
      message: 'Too many pairing attempts from this network address — try again in 42 s.',
      retryAfterSeconds: 42,
      limit: 'source',
    });
  });

  it('marks a genuine local request as the trusted source, and a forwarded one as not', async () => {
    const { app, previewPairingGrant } = makeApp(async () => ({
      deviceNameHint: 'p',
      platform: 'mobile',
      requestedScopes: [],
      expiresAt: 1,
    }));
    await request(app).post('/api/auth/pair/preview').send({ pairingToken: 'ABCD-EFGH-JKMN' }).expect(200);
    expect(previewPairingGrant.mock.calls[0]![0]).toMatchObject({ trustedSource: true });

    await request(app)
      .post('/api/auth/pair/preview')
      .set('x-forwarded-for', '192.168.1.50')
      .send({ pairingToken: 'ABCD-EFGH-JKMN' })
      .expect(200);
    expect(previewPairingGrant.mock.calls[1]![0]).toMatchObject({ trustedSource: false });
  });
});

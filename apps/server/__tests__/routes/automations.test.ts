// ────────────────────────────────────────────────────────────────
// Automation Routes — webhook reachability, signature verification,
// token redaction, and idempotency-scope hashing.
//
// Deliberately mounts `createAutomationRoutes` on a minimal express() app
// with a hand-rolled `Container` rather than the shared `createTestApp`
// helper: that helper does not currently mock `automationService`, and it
// is mid-edit by another concurrent workstream (see git status), so this
// file stays self-contained to avoid colliding with it.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { createAutomationRoutes } from '../../src/routes/automations.js';
import { createErrorMiddleware } from '../../src/middleware/errorHandler.js';
import { hashWebhookToken, IdempotencyService } from '@generatorai/core';
import { SECRET_MASK } from '@generatorai/shared';
import type { Automation } from '@generatorai/shared';
import type { Container } from '../../src/composition-root.js';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Test automation',
    enabled: true,
    triggerType: 'webhook',
    workflowIds: ['wf-1'],
    variables: {},
    maxConcurrency: 1,
    onError: 'continue',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Automation;
}

/** In-memory stand-in for the real `SecretStore` (vault). */
function makeSecretStore() {
  const map = new Map<string, string>();
  const key = (ns: string, name: string) => `${ns}/${name}`;
  return {
    get: vi.fn(async (ns: string, name: string) => {
      const v = map.get(key(ns, name));
      return v === undefined ? null : new TextEncoder().encode(v);
    }),
    set: vi.fn(async (ns: string, name: string, value: Uint8Array) => {
      map.set(key(ns, name), new TextDecoder().decode(value));
    }),
    create: vi.fn(async (ns: string, name: string, value: Uint8Array) => {
      map.set(key(ns, name), new TextDecoder().decode(value));
    }),
    remove: vi.fn(async (ns: string, name: string) => {
      map.delete(key(ns, name));
    }),
    removeNamespace: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    getOrCreateRandom: vi.fn(async () => new Uint8Array(32)),
    backendInfo: vi.fn(async () => ({ kind: 'test', secure: true, supportsRotation: false })),
    _map: map,
  };
}

function buildApp(automationOverrides: Record<string, unknown> = {}) {
  const app: Express = express();
  // Mirrors app.ts's raw-body capture hook for the automations webhook prefix
  // — signature verification needs the exact bytes the sender signed.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        const url = (req as { originalUrl?: string }).originalUrl ?? '';
        if (url.startsWith('/api/automations/webhooks')) {
          (req as unknown as { rawBody?: Buffer }).rawBody = buf;
        }
      },
    }),
  );

  const secretStore = makeSecretStore();
  const automationService = {
    createAutomation: vi.fn(),
    listAutomations: vi.fn(async () => []),
    getAutomationWithExecutions: vi.fn(),
    updateAutomation: vi.fn(),
    deleteAutomation: vi.fn(async () => {}),
    enableAutomation: vi.fn(),
    disableAutomation: vi.fn(),
    rotateWebhookToken: vi.fn(),
    getAutomation: vi.fn(),
    triggerWebhook: vi.fn(),
    triggerManual: vi.fn(),
    getExecutionsByAutomation: vi.fn(async () => []),
    getExecutionWithRuns: vi.fn(),
    getExecution: vi.fn(),
    cancelExecution: vi.fn(async () => {}),
    ...automationOverrides,
  };
  const idempotencyKeyRepo = {
    claim: vi.fn(async (args: { executionId: string }) => ({ executionId: args.executionId, replay: false, requestHash: null })),
    updateExecutionId: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    sweepExpired: vi.fn(async () => 0),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  const container = {
    automationService,
    idempotencyKeyRepo,
    // The route claims keys through the shared service (P04).
    idempotencyService: new IdempotencyService(idempotencyKeyRepo),
    logger,
    security: { secretStore },
  } as unknown as Container;

  app.use('/api/automations', createAutomationRoutes(container));
  app.use(createErrorMiddleware(logger as never));

  return { app, automationService, idempotencyKeyRepo, secretStore, logger };
}

describe('Automation routes — webhook signature verification', () => {
  it('mints a one-time signing secret on create and enforces it on delivery', async () => {
    const rawToken = 'a'.repeat(64);
    const { app, automationService } = buildApp({
      createAutomation: vi.fn(async () => makeAutomation({ webhookToken: rawToken })),
      triggerWebhook: vi.fn(async () => ({ id: 'exec-1', status: 'pending' })),
    });

    const createRes = await request(app).post('/api/automations').send({
      name: 'x',
      triggerType: 'webhook',
      workflowIds: ['00000000-0000-0000-0000-000000000001'],
      permissionMode: 'acceptEdits', // PD-18: required
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.webhookToken).toBe(rawToken);
    const signingSecret: string = createRes.body.webhookSigningSecret;
    expect(typeof signingSecret).toBe('string');
    expect(signingSecret.length).toBeGreaterThan(0);

    const body = { hello: 'world' };
    const raw = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${crypto.createHmac('sha256', signingSecret).update(raw).digest('hex')}`;

    // Signed delivery, with NO Authorization/scope header at all — the whole
    // point of the public route — succeeds.
    const signedRes = await request(app)
      .post(`/api/automations/webhooks/${rawToken}`)
      .set('x-signature-256', signature)
      .send(body);
    expect(signedRes.status).toBe(202);
    expect(automationService.triggerWebhook).toHaveBeenCalledWith(rawToken, body, expect.any(String));

    // Unsigned delivery to the SAME (now-signed) automation is refused.
    const unsignedRes = await request(app)
      .post(`/api/automations/webhooks/${rawToken}`)
      .send(body);
    expect(unsignedRes.status).toBe(401);

    // Wrong signature is refused too.
    const wrongRes = await request(app)
      .post(`/api/automations/webhooks/${rawToken}`)
      .set('x-signature-256', 'sha256=' + '0'.repeat(64))
      .send(body);
    expect(wrongRes.status).toBe(401);
  });

  it('allows an unsigned delivery when no signing secret was ever minted', async () => {
    // createAutomation here returns no raw webhookToken (legacy round trip),
    // so no secret is minted — the route must fail OPEN on signature
    // enforcement (not lock out every automation created before signing).
    const { app, automationService } = buildApp({
      triggerWebhook: vi.fn(async () => ({ id: 'exec-1', status: 'pending' })),
    });

    const res = await request(app)
      .post('/api/automations/webhooks/some-legacy-token')
      .send({ a: 1 });

    expect(res.status).toBe(202);
    expect(automationService.triggerWebhook).toHaveBeenCalledWith('some-legacy-token', { a: 1 }, expect.any(String));
  });

  it('prefers the X-Webhook-Token header over the path segment', async () => {
    const { app, automationService } = buildApp({
      triggerWebhook: vi.fn(async () => ({ id: 'exec-1', status: 'pending' })),
    });

    const res = await request(app)
      .post('/api/automations/webhooks/placeholder')
      .set('x-webhook-token', 'the-real-token')
      .send({});

    expect(res.status).toBe(202);
    expect(automationService.triggerWebhook).toHaveBeenCalledWith('the-real-token', {}, expect.any(String));
  });

  it('scopes the idempotency claim to the token HASH, never the raw token', async () => {
    const rawToken = 'plaintext-token-value';
    const { app, idempotencyKeyRepo } = buildApp({
      triggerWebhook: vi.fn(async () => ({ id: 'exec-1', status: 'pending' })),
    });

    await request(app)
      .post(`/api/automations/webhooks/${rawToken}`)
      .set('idempotency-key', 'delivery-1')
      .send({});

    expect(idempotencyKeyRepo.claim).toHaveBeenCalledOnce();
    const claimArg = idempotencyKeyRepo.claim.mock.calls[0]![0] as { scope: string };
    expect(claimArg.scope).toBe(`webhook:${hashWebhookToken(rawToken)}`);
    expect(claimArg.scope).not.toContain(rawToken);
  });
});

describe('Automation routes — token/credential redaction on read paths', () => {
  it('never returns the raw token from GET /:id', async () => {
    const { app } = buildApp({
      getAutomationWithExecutions: vi.fn(async () => ({
        ...makeAutomation({
          webhookToken: 'super-secret-raw-token',
        }),
        executions: [{ id: 'exec-1' }],
      })),
    });

    const res = await request(app).get('/api/automations/auto-1');
    expect(res.status).toBe(200);
    expect(res.body.webhookToken).toBe(SECRET_MASK);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-raw-token');
    // The executions array must still be present — redaction must not drop it.
    expect(res.body.executions).toEqual([{ id: 'exec-1' }]);
  });

  it('never returns the raw token from GET / (list)', async () => {
    const { app } = buildApp({
      listAutomations: vi.fn(async () => [makeAutomation({ webhookToken: 'raw-token-1' })]),
    });

    const res = await request(app).get('/api/automations');
    expect(res.status).toBe(200);
    expect(res.body[0].webhookToken).toBe(SECRET_MASK);
  });

  it('never returns the raw token from PATCH, enable, or disable', async () => {
    const { app } = buildApp({
      updateAutomation: vi.fn(async () => makeAutomation({ webhookToken: 'raw-token-2' })),
      enableAutomation: vi.fn(async () => makeAutomation({ webhookToken: 'raw-token-2' })),
      disableAutomation: vi.fn(async () => makeAutomation({ webhookToken: 'raw-token-2' })),
    });

    const patchRes = await request(app).patch('/api/automations/auto-1').send({ name: 'renamed' });
    expect(patchRes.body.webhookToken).toBe(SECRET_MASK);

    const enableRes = await request(app).post('/api/automations/auto-1/enable');
    expect(enableRes.body.webhookToken).toBe(SECRET_MASK);

    const disableRes = await request(app).post('/api/automations/auto-1/disable');
    expect(disableRes.body.webhookToken).toBe(SECRET_MASK);
  });

  it('rotate-webhook-token returns a scoped { token, signingSecret } and forgets the old secret', async () => {
    const { app, secretStore } = buildApp({
      getAutomation: vi.fn(async () => makeAutomation({ webhookTokenHash: 'old-hash' })),
      rotateWebhookToken: vi.fn(async () => makeAutomation({ webhookToken: 'brand-new-token' })),
    });

    const res = await request(app).post('/api/automations/auto-1/rotate-webhook-token');
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('brand-new-token');
    expect(typeof res.body.signingSecret).toBe('string');
    expect(secretStore.remove).toHaveBeenCalledWith('automation-webhook', 'old-hash');
  });
});

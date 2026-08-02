// ────────────────────────────────────────────────────────────────
// Auth middleware — principal resolution, scope enforcement, leak prevention.
//
// This replaces the old shared-API-key tests. The middleware no longer
// compares one global key: it resolves a `Principal` through `AuthService` and
// checks it against the route → scope policy table.
//
// The properties pinned down here are exactly the ones that would be a
// vulnerability if they regressed:
//
//   1. Public routes stay reachable without a credential.
//   2. An authenticated principal missing a scope gets 403 — NOT 200.
//   3. An unclassified route fails CLOSED.
//   4. Credentials never reach the log, even on a rejected request.
//
// End-to-end DPoP, pairing, ticket redemption and revocation are covered by
// `agent-tests/security-e2e.mjs`, which drives a real server.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { ILogger } from '@generatorai/shared';
import { AuthError, type Principal, type Scope } from '@generatorai/auth';
import { createAuthMiddleware } from '../../src/middleware/auth.js';

function testLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ILogger;
}

function principalWith(scopes: Scope[]): Principal {
  return {
    type: 'paired-device',
    id: 'device-1',
    displayName: 'Test device',
    scopes,
    transport: 'loopback',
  };
}

/**
 * Builds an app whose `AuthService` returns `principal`, or throws `authError`.
 * Passing neither models an unauthenticated caller.
 */
function makeApp(options: { principal?: Principal; authError?: AuthError }) {
  const logger = testLogger();
  const audit = { record: vi.fn() };
  const authenticate = vi.fn(async () => {
    if (options.authError) throw options.authError;
    if (!options.principal) throw new AuthError('Missing credential.', 'MISSING_CREDENTIAL');
    return options.principal;
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'req-test';
    next();
  });
  app.use(
    '/api',
    createAuthMiddleware({
      auth: { authenticate } as never,
      audit: audit as never,
      logger,
    }),
  );

  app.get('/api/health', (_req, res) => { res.json({ ok: true, route: 'health' }); });
  app.get('/api/chats', (_req, res) => { res.json({ ok: true, route: 'chats' }); });
  app.post('/api/workspaces/w1/terminals', (_req, res) => {
    res.json({ ok: true, route: 'terminal' });
  });
  app.delete('/api/auth/devices/d1', (_req, res) => { res.json({ ok: true, route: 'revoke' }); });
  app.get('/api/some-brand-new-endpoint', (_req, res) => { res.json({ ok: true }); });

  return { app, logger, audit, authenticate };
}

describe('auth middleware', () => {
  describe('public routes', () => {
    it('serves health without any credential', async () => {
      const { app, authenticate } = makeApp({});
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      // A public route must not even attempt authentication — otherwise a
      // liveness probe would spam the audit log with failures.
      expect(authenticate).not.toHaveBeenCalled();
    });
  });

  describe('missing or invalid credential', () => {
    let app: ReturnType<typeof makeApp>['app'];
    let logger: ILogger;

    beforeEach(() => {
      ({ app, logger } = makeApp({}));
    });

    it('rejects a protected route with 401', async () => {
      const res = await request(app).get('/api/chats');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_CREDENTIAL');
    });

    it('advertises DPoP in WWW-Authenticate so a client knows what to send', async () => {
      const res = await request(app).get('/api/chats');
      expect(res.headers['www-authenticate']).toContain('DPoP');
    });

    it('returns a DPoP-Nonce when the server demands one', async () => {
      const err = new AuthError('Nonce required', 'NONCE_REQUIRED');
      (err as { nonce?: string }).nonce = 'server-nonce-123';
      const { app: nonceApp } = makeApp({ authError: err });
      const res = await request(nonceApp).get('/api/chats');
      expect(res.headers['dpop-nonce']).toBe('server-nonce-123');
      expect(res.headers['www-authenticate']).toContain('use_dpop_nonce');
    });

    it('never logs the request URL, which can carry ?ticket=', async () => {
      await request(app).get('/api/chats?ticket=super-secret-value');
      const logged = JSON.stringify((logger.warn as ReturnType<typeof vi.fn>).mock.calls);
      expect(logged).not.toContain('super-secret-value');
      // The path is safe and useful, so it should still be there.
      expect(logged).toContain('/chats');
    });
  });

  describe('scope enforcement', () => {
    it('allows a principal holding the required scope', async () => {
      const { app } = makeApp({ principal: principalWith(['read:chats']) });
      const res = await request(app).get('/api/chats');
      expect(res.status).toBe(200);
      expect(res.body.route).toBe('chats');
    });

    it('rejects an authenticated principal that lacks the scope', async () => {
      // The dangerous regression: a valid credential must not be enough on its
      // own. A read-only mobile device must never open a terminal.
      const { app } = makeApp({ principal: principalWith(['read:chats']) });
      const res = await request(app).post('/api/workspaces/w1/terminals');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_SCOPE');
      expect(res.body.error.requiredScopes).toContain('exec:terminal');
    });

    it('records an audit event when a request is denied for scope', async () => {
      const { app, audit } = makeApp({ principal: principalWith(['read:chats']) });
      await request(app).post('/api/workspaces/w1/terminals');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'denied', reasonCode: 'INSUFFICIENT_SCOPE' }),
      );
    });

    it('fails closed on an unclassified route', async () => {
      // An unmapped route falls back to DEFAULT_POLICY, which demands admin.
      // A new endpoint is therefore unreachable until it declares a policy —
      // the opposite of the historical "public unless explicitly guarded".
      const { app } = makeApp({ principal: principalWith(['read:chats']) });
      const res = await request(app).get('/api/some-brand-new-endpoint');
      expect(res.status).toBe(403);
    });

    it('requires admin:devices to revoke a device', async () => {
      const withoutAdmin = makeApp({ principal: principalWith(['write:chats']) });
      expect((await request(withoutAdmin.app).delete('/api/auth/devices/d1')).status).toBe(403);

      const withAdmin = makeApp({ principal: principalWith(['admin:devices']) });
      expect((await request(withAdmin.app).delete('/api/auth/devices/d1')).status).toBe(200);
    });
  });
});

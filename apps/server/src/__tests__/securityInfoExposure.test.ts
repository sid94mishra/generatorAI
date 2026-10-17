// Audit F-6 (D-120): the public `server-info` handed any unauthenticated LAN
// peer the machine hostname, every interface address and the certificate's
// name list; `/security/posture` gave every paired device (read:status) the
// bind address, secret backend and legacy-key status. Pairing still gets what
// it needs; the configuration detail is for admin:settings.

import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hostname } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Principal } from '@generatorai/auth';
import { createAuthRoutes } from '../routes/auth.js';
import { createSecurityRoutes } from '../routes/security.js';

const TLS_STATUS = {
  enabled: true as const,
  source: 'generated' as const,
  fingerprintSha256: 'AA:BB',
  caFingerprintSha256: 'CC:DD',
  issuer: `GeneratorAI local CA (${hostname()})`,
  notBefore: 1,
  notAfter: 2,
  names: [`${hostname()}.local`, '192.168.1.20', '10.8.0.2', 'localhost'],
  customCertificateProblem: null,
};

const dirs: string[] = [];
afterEach(() => {
  delete process.env['GENERATORAI_SERVER_NAME'];
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeApp(principal?: Principal) {
  const dataDir = mkdtempSync(join(tmpdir(), 'f6-'));
  dirs.push(dataDir);
  const container = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: { port: 3100, dbPath: join(dataDir, 'x.db'), security: { corsOrigins: [] } },
    relayHostBroker: { connectionState: 'idle', relayHostId: 'relay-host' },
    security: {
      devices: {},
      deviceRepo: { list: vi.fn(async () => []) },
      secretStore: { backendInfo: vi.fn(async () => ({ kind: 'file-aes', secure: true, supportsRotation: true })) },
      tokens: { publicJwk: vi.fn(() => ({ kty: 'OKP' })) },
      dpop: {},
      audit: { record: vi.fn() },
      posture: {
        tokenAudience: 'generatorai-server',
        authenticationRequired: true,
        legacyApiKeyActive: true,
        bindHost: '0.0.0.0',
        loopbackOnly: false,
        production: false,
        unauthenticatedLoopback: false,
        relayEnabled: false,
        tlsUnavailableReason: null,
      },
      identity: { hostId: 'host-id', publicKeyBase64Url: 'pk' },
      tls: { status: () => TLS_STATUS, version: 1, extraHostnames: () => [] },
    },
  };
  const app = express();
  app.use((req, _res, next) => {
    if (principal) req.principal = principal;
    next();
  });
  app.use('/api/auth', createAuthRoutes(container as never));
  app.use('/api/security', createSecurityRoutes(container as never));
  return app;
}

const device = (scopes: string[]): Principal => ({
  type: 'paired-device',
  id: 'd1',
  scopes: scopes as Principal['scopes'],
  transport: 'lan',
});

describe('GET /api/auth/server-info (public)', () => {
  it('never names the machine, maps its interfaces or lists the certificate names', async () => {
    const res = await request(makeApp()).get('/api/auth/server-info').set('host', '127.0.0.1:3100');
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw.toLowerCase()).not.toContain(hostname().toLowerCase());
    expect(res.body.serverName).toBeUndefined();
    expect(raw).not.toContain('10.8.0.2');
    expect(res.body.tls).toEqual({ enabled: true, source: 'generated', fingerprintSha256: 'AA:BB', caFingerprintSha256: 'CC:DD', notAfter: 2 });
    expect(res.body.authentication).toEqual({ required: true, dpopRequired: true });
    // Only the endpoint this request used, if it is one the server advertises.
    for (const endpoint of res.body.endpoints as Array<{ origin: string }>) {
      expect(endpoint.origin).toBe('http://127.0.0.1:3100');
    }
    // Identification still works.
    expect(res.body.serverId).toBe('host-id');
    expect(res.body.protocolVersion).toBe(2);
  });

  it('shows the operator-set display name', async () => {
    process.env['GENERATORAI_SERVER_NAME'] = 'Studio';
    const res = await request(makeApp()).get('/api/auth/server-info');
    expect(res.body.serverName).toBe('Studio');
  });
});

describe('GET /api/security/posture and /network-access', () => {
  it('a read:status device gets the limited view: no bind address, backend, legacy key or warnings', async () => {
    const app = makeApp(device(['read:status']));
    const posture = await request(app).get('/api/security/posture');
    expect(posture.body).toEqual({
      detail: 'limited',
      server: { hostId: 'host-id', loopbackOnly: false },
      authentication: { required: true, dpopRequired: true },
      relay: { enabled: false, clientAvailable: false },
      scopes: expect.any(Array),
      // U-47: New chat preselects the deployment's permission default, so every client may read it.
      agents: { defaultPermissionMode: expect.any(String) },
    });
    const network = await request(app).get('/api/security/network-access');
    expect(network.body).toEqual({
      detail: 'limited',
      mode: 'local-only',
      active: true,
      pendingRestart: true,
      blockers: [],
    });
  });

  it('an admin:settings device gets the full view', async () => {
    const app = makeApp(device(['read:status', 'admin:settings']));
    const posture = await request(app).get('/api/security/posture');
    expect(posture.body.detail).toBe('full');
    expect(posture.body.server.bindHost).toBe('0.0.0.0');
    expect(posture.body.secretStore.kind).toBe('file-aes');
    expect(posture.body.authentication.legacyApiKeyActive).toBe(true);
    expect(posture.body.warnings.map((w: { code: string }) => w.code)).toContain('LEGACY_API_KEY');
    const network = await request(app).get('/api/security/network-access');
    expect(network.body.detail).toBe('full');
    expect(network.body.bindHost).toBe('0.0.0.0');
    expect(network.body.tls.names).toEqual(TLS_STATUS.names);
    expect(network.body.trustProxy).toEqual(expect.objectContaining({ mode: expect.any(String) }));
  });
});

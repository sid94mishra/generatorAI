// Auth tests for the Computer Use loopback handshake. The two checks are
// independent by design: the loopback test guards against the server ever
// binding beyond 127.0.0.1, and the bearer test against a local process that
// is not the desktop shell.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createInternalComputerRoutes } from '../routes/internal-computer.js';

const TOKEN = 'test-token-value';

function makeApp(container: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/internal/computer', createInternalComputerRoutes(container as never));
  return app;
}

function makeContainer() {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cuaDriverBridge: { setEndpoint: vi.fn() },
    computerConsentStore: { resolve: vi.fn(() => true) },
  };
}

const ENDPOINT = {
  socketPath: '/tmp/cua.sock',
  driverVersion: '0.19.3',
  pid: 1234,
  platform: 'darwin',
};

describe('internal computer routes', () => {
  beforeEach(() => {
    process.env['GENERATORAI_ELECTRON_IPC_TOKEN'] = TOKEN;
  });
  afterEach(() => {
    delete process.env['GENERATORAI_ELECTRON_IPC_TOKEN'];
  });

  it('rejects a request with no bearer token', async () => {
    const container = makeContainer();
    await request(makeApp(container))
      .post('/internal/computer/endpoint')
      .send({ workspaceId: 'ws-1', endpoint: ENDPOINT })
      .expect(401);
    expect(container.cuaDriverBridge.setEndpoint).not.toHaveBeenCalled();
  });

  it('rejects a wrong bearer token', async () => {
    const container = makeContainer();
    await request(makeApp(container))
      .post('/internal/computer/endpoint')
      .set('authorization', 'Bearer not-the-token')
      .send({ workspaceId: 'ws-1', endpoint: ENDPOINT })
      .expect(401);
    expect(container.cuaDriverBridge.setEndpoint).not.toHaveBeenCalled();
  });

  it('rejects everything when no token is configured', async () => {
    delete process.env['GENERATORAI_ELECTRON_IPC_TOKEN'];
    await request(makeApp(makeContainer()))
      .post('/internal/computer/endpoint')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ workspaceId: 'ws-1', endpoint: ENDPOINT })
      .expect(401);
  });

  it('accepts a correctly authenticated endpoint push', async () => {
    const container = makeContainer();
    await request(makeApp(container))
      .post('/internal/computer/endpoint')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ workspaceId: 'ws-1', endpoint: ENDPOINT })
      .expect(200);
    expect(container.cuaDriverBridge.setEndpoint).toHaveBeenCalledWith('ws-1', ENDPOINT);
  });

  it('accepts a null endpoint to clear the registration', async () => {
    const container = makeContainer();
    await request(makeApp(container))
      .post('/internal/computer/endpoint')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ workspaceId: 'ws-1', endpoint: null })
      .expect(200);
    expect(container.cuaDriverBridge.setEndpoint).toHaveBeenCalledWith('ws-1', null);
  });

  it('rejects a malformed endpoint body', async () => {
    const container = makeContainer();
    await request(makeApp(container))
      .post('/internal/computer/endpoint')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ workspaceId: 'ws-1', endpoint: { socketPath: '' } })
      .expect(400);
    expect(container.cuaDriverBridge.setEndpoint).not.toHaveBeenCalled();
  });

  it('requires appIdentity on a consent answer', async () => {
    const container = makeContainer();
    await request(makeApp(container))
      .post('/internal/computer/consent')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ requestId: 'req-1', decision: 'allow_once' })
      .expect(400);
    expect(container.computerConsentStore.resolve).not.toHaveBeenCalled();
  });

  it('rejects a decision outside the union', async () => {
    const container = makeContainer();
    await request(makeApp(container))
      .post('/internal/computer/consent')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ requestId: 'req-1', appIdentity: 'com.a', decision: 'maybe' })
      .expect(400);
    expect(container.computerConsentStore.resolve).not.toHaveBeenCalled();
  });

  it('forwards a well-formed consent answer with its app identity', async () => {
    const container = makeContainer();
    await request(makeApp(container))
      .post('/internal/computer/consent')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ requestId: 'req-1', appIdentity: 'com.a', decision: 'always_allow' })
      .expect(200);
    expect(container.computerConsentStore.resolve).toHaveBeenCalledWith('req-1', 'always_allow', 'com.a');
  });

  it('reports 503 rather than silently succeeding when computer use is unwired', async () => {
    const container = { ...makeContainer(), cuaDriverBridge: undefined, computerConsentStore: undefined };
    await request(makeApp(container))
      .post('/internal/computer/endpoint')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ workspaceId: 'ws-1', endpoint: ENDPOINT })
      .expect(503);
  });
});

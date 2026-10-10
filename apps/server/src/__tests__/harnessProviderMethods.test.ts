// ────────────────────────────────────────────────────────────────
// G-09 — the provider routes behind the platform client's
// getHarnessProviders / loginProvider / logoutProvider / setDefaultProvider.
//
// Pinned: the providers body matches the shared `HarnessProvidersResponse`
// (every field the picker reads, `supportsLogin` from the live adapter, a
// boolean `stale`), sign-in / sign-out answer 404 for an unknown provider and
// 409 when the adapter has no in-app flow, and a not-ready provider cannot be
// made the default.
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { HarnessProvidersResponse } from '@generatorai/shared';

import { createHarnessRoutes } from '../routes/harness.js';
import type { Container } from '../composition-root.js';

const OPUS = {
  id: 'opus',
  name: 'Opus',
  description: 'Deep reasoning',
  promptTokenLimit: 200_000,
  longContext: { promptTokenLimit: 1_000_000 },
  maxOutputTokens: 64_000,
  supportsVision: true,
  supportsReasoning: true,
  reasoningEfforts: ['low', 'medium', 'high'],
  defaultReasoningEffort: 'medium',
};

function makeRegistry() {
  const statuses = [
    { type: 'copilot', label: 'GitHub Copilot', installed: true, connected: false, authenticated: false, ready: false, models: [], error: 'Not signed in' },
    { type: 'claude-agent', label: 'Claude Code', installed: true, connected: true, authenticated: true, ready: true, models: [OPUS], checkedAt: 1 },
    { type: 'codex', label: 'Codex', installed: true, connected: true, authenticated: true, ready: true, models: [] },
  ];
  const codex = {
    startLogin: vi.fn(async () => ({ authUrl: 'https://auth.example/login', loginId: 'l1' })),
    logout: vi.fn(async () => undefined),
  };
  const claude = { startLogin: vi.fn(async () => ({ completed: true })) };
  const registry = {
    primary: 'copilot',
    hasProbedStatuses: true,
    statusesAreStale: false,
    getStatuses: () => statuses,
    requestRefresh: vi.fn(),
    invalidate: vi.fn(),
    isHidden: () => false,
    refresh: vi.fn(async () => statuses),
    peek: (type: string) => (type === 'codex' ? codex : type === 'claude-agent' ? claude : { name: type }),
    get: vi.fn(async (type: string) => (type === 'codex' ? codex : type === 'claude-agent' ? claude : { name: type })),
    setPrimary: vi.fn(),
  };
  return { registry, codex, claude };
}

function makeApp(registry: unknown) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/harness',
    createHarnessRoutes({
      harnessRegistry: registry,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as unknown as Container),
  );
  return app;
}

describe('GET /api/harness/providers (G-09 shape)', () => {
  it('returns the shared HarnessProvidersResponse with every field the picker reads', async () => {
    const { registry } = makeRegistry();
    const res = await request(makeApp(registry)).get('/api/harness/providers').expect(200);
    const body = res.body as HarnessProvidersResponse;
    expect(body.primary).toBe('copilot');
    expect(body.stale).toBe(false);
    expect(body.providers.map((p) => [p.type, p.ready, p.supportsLogin, p.modelCount])).toEqual([
      ['copilot', false, false, 0],
      ['claude-agent', true, true, 1],
      ['codex', true, true, 0],
    ]);
    expect(body.providers[0]).toMatchObject({ installed: true, authenticated: false, error: 'Not signed in' });
    expect(body.providers[1]!.models[0]).toEqual(OPUS);
  });
});

describe('POST /api/harness/providers/:type/login|logout', () => {
  it('404s an unknown provider on both routes', async () => {
    const { registry } = makeRegistry();
    const app = makeApp(registry);
    const login = await request(app).post('/api/harness/providers/nope/login').expect(404);
    expect(login.body.error.code).toBe('NOT_FOUND');
    await request(app).post('/api/harness/providers/nope/logout').expect(404);
  });

  it('409s a provider without an in-app flow', async () => {
    const { registry } = makeRegistry();
    const app = makeApp(registry);
    expect((await request(app).post('/api/harness/providers/copilot/login').expect(409)).body.error.code).toBe('UNSUPPORTED');
    expect((await request(app).post('/api/harness/providers/claude-agent/logout').expect(409)).body.error.code).toBe('UNSUPPORTED');
  });

  it('answers a browser flow with authUrl and re-probes a completed one', async () => {
    const { registry, codex } = makeRegistry();
    const app = makeApp(registry);
    const browser = await request(app).post('/api/harness/providers/codex/login').expect(200);
    expect(browser.body).toEqual({ authUrl: 'https://auth.example/login', loginId: 'l1' });
    expect(codex.startLogin).toHaveBeenCalledTimes(1);
    expect(registry.requestRefresh).not.toHaveBeenCalled();

    const done = await request(app).post('/api/harness/providers/claude-agent/login').expect(200);
    expect(done.body).toEqual({ completed: true });
    expect(registry.requestRefresh).toHaveBeenCalledTimes(1);
  });

  it('signs out and re-probes', async () => {
    const { registry, codex } = makeRegistry();
    const res = await request(makeApp(registry)).post('/api/harness/providers/codex/logout').expect(200);
    expect(res.body).toEqual({ ok: true });
    expect(codex.logout).toHaveBeenCalledTimes(1);
    expect(registry.requestRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/harness/switch', () => {
  it('refuses to make a provider that is not ready the default', async () => {
    const { registry } = makeRegistry();
    registry.primary = 'claude-agent';
    const res = await request(makeApp(registry)).post('/api/harness/switch').send({ type: 'copilot' }).expect(409);
    expect(res.body.error.code).toBe('HARNESS_NOT_READY');
    expect(registry.setPrimary).not.toHaveBeenCalled();
  });

  it('switches to a ready provider', async () => {
    const { registry } = makeRegistry();
    const res = await request(makeApp(registry)).post('/api/harness/switch').send({ type: 'codex' }).expect(200);
    expect(res.body).toEqual({ message: "Switched to 'codex'", type: 'codex', switched: true });
    expect(registry.setPrimary).toHaveBeenCalledWith('codex');
  });
});

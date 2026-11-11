// ────────────────────────────────────────────────────────────────
// D-131 — server-level provider visibility.
//
// Pinned: stable providers are served and experimental ones hidden by default;
// `GENERATORAI_EXPERIMENTAL_PROVIDERS` reveals providers the setting cannot
// hide again; an admin's choice persists and is re-applied to the registry;
// the routes list every provider, validate the body, and answer a hidden
// provider's sign-in / sign-out / switch exactly like an unknown one.
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessVisibilityResponse } from '@generatorai/shared';

import { createHarnessRoutes } from '../routes/harness.js';
import type { Container } from '../composition-root.js';
import {
  EXPERIMENTAL_PROVIDERS_ENV,
  ProviderVisibilityStore,
  parseRevealEnv,
  resolveProviderVisibility,
} from '../settings/providerVisibility.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'provider-visibility-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const visibleOf = (list: Array<{ type: string; visible: boolean }>) =>
  Object.fromEntries(list.map((p) => [p.type, p.visible]));

describe('resolveProviderVisibility', () => {
  it('serves the stable providers and hides the experimental ones by default', () => {
    expect(visibleOf(resolveProviderVisibility({ visible: {} }, new Set()))).toEqual({
      copilot: true,
      'claude-agent': true,
      codex: true,
      opencode: true,
      acp: true,
    });
  });

  it('applies a saved choice to experimental providers only', () => {
    const stabilities = { copilot: 'stable', 'claude-agent': 'stable', codex: 'stable', opencode: 'experimental', acp: 'experimental' } as const;
    // Hidden while experimental: the choice holds…
    expect(visibleOf(resolveProviderVisibility({ visible: { opencode: true, acp: false } }, new Set(), stabilities))).toMatchObject({ opencode: true, acp: false });
    // …and once the provider is stable a "hidden" saved back then no longer hides it (Settings has no switch for it).
    const stable = resolveProviderVisibility({ visible: { opencode: false, acp: false, codex: false } }, new Set());
    expect(visibleOf(stable)).toMatchObject({ opencode: true, acp: true, codex: true });
    expect(stable.find((p) => p.type === 'acp')).toMatchObject({ source: 'default' });
  });

  it('an env reveal wins over a setting that hides the provider', () => {
    const list = resolveProviderVisibility({ visible: { opencode: false } }, new Set(['opencode']));
    expect(list.find((p) => p.type === 'opencode')).toMatchObject({ visible: true, source: 'env', stability: 'stable' });
  });

  it('parses the env list, `all`, and ignores unknown ids', () => {
    expect([...parseRevealEnv('opencode, ACP ,nope')].sort()).toEqual(['acp', 'opencode']);
    expect(parseRevealEnv('all').size).toBe(5);
    expect(parseRevealEnv(undefined).size).toBe(0);
  });
});

describe('ProviderVisibilityStore', () => {
  it('persists a change and re-applies the hidden set; every provider is stable, so nothing is hidden', async () => {
    const applied: string[][] = [];
    const store = await ProviderVisibilityStore.load(dir, {}, (hidden) => applied.push([...hidden].sort()));
    expect(applied.at(-1)).toEqual([]);

    await store.update({ opencode: false, codex: false });
    expect(applied).toHaveLength(2);
    expect(applied.at(-1)).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(dir, 'provider-visibility.json'), 'utf8')).visible).toEqual({
      opencode: false,
      codex: false,
    });

    // A file written while OpenCode and ACP were experimental (both hidden) hides neither after a restart.
    const again = await ProviderVisibilityStore.load(dir, {}, () => undefined);
    expect(again.hidden()).toEqual([]);
  });

  it('reads the env reveal list', async () => {
    const store = await ProviderVisibilityStore.load(dir, { [EXPERIMENTAL_PROVIDERS_ENV]: 'acp' }, () => undefined);
    expect(store.hidden()).toEqual([]);
  });
});

function makeApp(store: ProviderVisibilityStore, hidden: Set<string>) {
  const registry = {
    primary: 'claude-agent',
    isHidden: (t: string) => hidden.has(t),
    invalidate: vi.fn(),
    requestRefresh: vi.fn(),
    getStatuses: () => [],
    refresh: vi.fn(async () => []),
    peek: () => ({ logout: vi.fn() }),
    get: vi.fn(async () => ({ startLogin: vi.fn(async () => ({ completed: true })) })),
    setPrimary: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/harness',
    createHarnessRoutes({
      harnessRegistry: registry,
      providerVisibility: store,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as unknown as Container),
  );
  return { app, registry };
}

describe('/api/harness/visibility', () => {
  it('lists every provider and changes visibility, re-probing at once', async () => {
    const hidden = new Set<string>();
    const store = await ProviderVisibilityStore.load(dir, {}, (h) => {
      hidden.clear();
      for (const t of h) hidden.add(t);
    });
    const { app, registry } = makeApp(store, hidden);

    const listed = (await request(app).get('/api/harness/visibility').expect(200)).body as HarnessVisibilityResponse;
    expect(listed.providers.map((p) => p.type)).toEqual(['copilot', 'claude-agent', 'codex', 'opencode', 'acp']);

    const changed = (await request(app).put('/api/harness/visibility').send({ visible: { opencode: true } }).expect(200))
      .body as HarnessVisibilityResponse;
    expect(changed.providers.find((p) => p.type === 'opencode')).toMatchObject({ visible: true, source: 'default' });
    expect(hidden.has('opencode')).toBe(false);
    expect(registry.requestRefresh).toHaveBeenCalled();
  });

  it('rejects an unknown provider or a malformed body', async () => {
    const store = await ProviderVisibilityStore.load(dir, {}, () => undefined);
    const { app } = makeApp(store, new Set());
    await request(app).put('/api/harness/visibility').send({ visible: { nope: true } }).expect(400);
    await request(app).put('/api/harness/visibility').send({ visible: { codex: 'yes' } }).expect(400);
    await request(app).put('/api/harness/visibility').send({}).expect(400);
  });

  it('answers a hidden provider like an unknown one (sign-in, sign-out, switch, known types)', async () => {
    const store = await ProviderVisibilityStore.load(dir, {}, () => undefined);
    const { app } = makeApp(store, new Set(['opencode']));
    await request(app).post('/api/harness/providers/opencode/login').expect(404);
    await request(app).post('/api/harness/providers/opencode/logout').expect(404);
    await request(app).post('/api/harness/switch').send({ type: 'opencode' }).expect(400);
    const root = await request(app).get('/api/harness').expect(200);
    expect(root.body.knownTypes).not.toContain('opencode');
  });

  it('drops the provider catalog after a sign-in completes or a sign-out', async () => {
    const store = await ProviderVisibilityStore.load(dir, {}, () => undefined);
    const { app, registry } = makeApp(store, new Set());
    await request(app).post('/api/harness/providers/codex/login').expect(200);
    await request(app).post('/api/harness/providers/codex/logout').expect(200);
    expect(registry.invalidate).toHaveBeenCalledWith('codex');
    expect(registry.invalidate).toHaveBeenCalledTimes(2);
  });
});

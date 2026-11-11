// docs/acp — AcpAgentsService + /api/acp end to end, with the real `acp` provider and the fake ACP agent
// (no third-party download): a registry served by a fake fetch whose "binary" launches the fixture, install with
// sha256 → enable (live, no restart) → models with subProvider → env in the secret store (names only on the
// wire) → terminal sign-in spec → reinitialize → update available → uninstall; custom agents; route errors.

import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemorySecretStore, SecretNamespace } from '@generatorai/secrets';
import { AcpProvider } from '@generatorai/agent-harness-providers/acp';
import { acpPlatformKey } from '@generatorai/agent-harness-providers';
import type { AcpAgentsResponse, AcpTerminalAuthSpec } from '@generatorai/shared';
import { AcpAgentsService } from '../settings/acpAgents.js';
import { createAcpRoutes } from '../routes/acp.js';
import type { Container } from '../composition-root.js';

const FIXTURE = fileURLToPath(
  new URL('../../../../packages/agent-harness-providers/src/providers/acp/__tests__/fixtures/fakeAcpAgent.mjs', import.meta.url),
);
const WIN = process.platform === 'win32';

/** A one-file tar (ustar) — the agent's launcher script, which runs the fixture with this Node. */
function launcherArchive(env: Record<string, string>): Buffer {
  const name = WIN ? 'bin/fake.cmd' : 'bin/fake';
  const assigns = Object.entries(env);
  const body = Buffer.from(
    WIN
      ? `@echo off\r\n${assigns.map(([k, v]) => `set ${k}=${v}\r\n`).join('')}"${process.execPath}" "${FIXTURE}" %*\r\n`
      : `#!/bin/sh\n${assigns.map(([k, v]) => `export ${k}='${v}'\n`).join('')}exec '${process.execPath}' '${FIXTURE}' "$@"\n`,
  );
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000644\0', 100, 8);
  header.write('0000000\0', 108, 8);
  header.write('0000000\0', 116, 8);
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12);
  header.write('00000000000\0', 136, 12);
  header.write('        ', 148, 8);
  header.write('0', 156, 1);
  header.write('ustar\0', 257, 6);
  header.write('00', 263, 2);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512), Buffer.alloc(1024)]));
}

let dir: string;
let provider: AcpProvider | null;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'gai-acp-svc-'));
  provider = null;
});
afterEach(async () => {
  await provider?.shutdown();
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
});

async function setup(opts: { version?: string; agentEnv?: Record<string, string> } = {}) {
  const archive = launcherArchive(opts.agentEnv ?? {});
  const key = acpPlatformKey()!;
  let version = opts.version ?? '1.0.0';
  const registry = () => ({
    version: '1.0.0',
    agents: [
      {
        id: 'fake',
        name: 'Fake Agent',
        version,
        description: 'A test agent',
        icon: 'https://registry.test/fake.svg',
        distribution: {
          binary: { [key]: { archive: 'https://registry.test/fake.tar.gz', cmd: WIN ? './bin/fake.cmd' : './bin/fake', args: [], sha256: createHash('sha256').update(archive).digest('hex') } },
        },
      },
      { id: 'claude-acp', name: 'Claude Agent', version: '0.1.0', description: '', distribution: { npx: { package: '@x/claude@0.1.0' } } },
      { id: 'pyonly', name: 'Py', version: '1.0.0', description: '', distribution: { uvx: { package: 'py==1.0.0' } } },
    ],
  });
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('.tar.gz')) return new Response(archive, { status: 200 });
    if (url.endsWith('.svg')) return new Response('<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>', { status: 200 });
    return new Response(JSON.stringify(registry()), { status: 200 });
  }) as unknown as typeof fetch;
  const onCatalogChange = vi.fn();
  const secrets = new MemorySecretStore();
  const svc: AcpAgentsService = await AcpAgentsService.load({
    dataDir: dir,
    secretStore: secrets,
    provider: async () => {
      if (!provider) {
        provider = new AcpProvider({ agents: svc.launches(), defaultCwd: dir });
        await provider.initialize();
      }
      return provider;
    },
    peekProvider: () => provider,
    onCatalogChange,
    fetchImpl,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/acp', createAcpRoutes({ acpAgents: svc, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } as unknown as Container));
  return { svc, app, secrets, onCatalogChange, bump: (v: string) => { version = v; } };
}

async function untilInstalled(app: express.Express, id: string): Promise<AcpAgentsResponse> {
  for (let i = 0; i < 200; i++) {
    const body = (await request(app).get('/api/acp/agents').expect(200)).body as AcpAgentsResponse;
    const a = body.agents.find((x) => x.id === id)!;
    if (!a.installing) return body;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('install did not finish');
}

describe('/api/acp', () => {
  it('lists the registry with platform availability, native providers and marks; refresh fetches the network', async () => {
    const { app } = await setup();
    const refreshed = (await request(app).post('/api/acp/registry/refresh').expect(200)).body as AcpAgentsResponse;
    expect(refreshed.registry.source).toBe('network');
    expect(refreshed.platform).toBe(acpPlatformKey());
    const byId = Object.fromEntries(refreshed.agents.map((a) => [a.id, a]));
    expect(byId['fake']).toMatchObject({ name: 'Fake Agent', version: '1.0.0', installed: null, enabled: false, distribution: { selected: 'binary', offered: ['binary'] } });
    expect(byId['fake']!.mark).toEqual({ viewBox: '0 0 16 16', nodes: [{ tag: 'circle', attrs: { cx: '8', cy: '8', r: '8' } }] });
    expect(byId['claude-acp']).toMatchObject({ nativeProvider: 'claude-agent', distribution: { selected: 'npx', package: '@x/claude@0.1.0' } });
    expect(byId['pyonly']!.distribution).toMatchObject({ selected: null, unavailableReason: expect.stringMatching(/uv/) });
  });

  it('installs, enables live, lists models, keeps env secret, gives the terminal sign-in, updates and uninstalls', async () => {
    const authFile = path.join(dir, 'signed-in');
    const { app, secrets, onCatalogChange, bump, svc } = await setup({ agentEnv: { FAKE_ACP_AUTH: 'terminal', FAKE_ACP_AUTH_FILE: authFile } });
    await request(app).post('/api/acp/registry/refresh').expect(200);
    await request(app).put('/api/acp/agents/fake/enabled').send({ enabled: true }).expect(409); // not installed yet

    const started = (await request(app).post('/api/acp/agents/fake/install').expect(202)).body as AcpAgentsResponse;
    expect(started.agents.find((a) => a.id === 'fake')!.installing).toBeDefined();
    const installed = (await untilInstalled(app, 'fake')).agents.find((a) => a.id === 'fake')!;
    expect(installed).toMatchObject({ installed: { version: '1.0.0', kind: 'binary', unverified: false }, updateAvailable: false });
    expect(installed.installError).toBeUndefined();

    await request(app).put('/api/acp/agents/fake/env').send({ env: { FAKE_TOKEN: 's3cret', 'bad name': 'x' } }).expect(400);
    const withEnv = (await request(app).put('/api/acp/agents/fake/env').send({ env: { FAKE_TOKEN: 's3cret' } }).expect(200)).body as AcpAgentsResponse;
    expect(withEnv.agents.find((a) => a.id === 'fake')!.env).toEqual([{ name: 'FAKE_TOKEN', set: true }]);
    expect(JSON.stringify(withEnv)).not.toContain('s3cret');
    expect(Buffer.from((await secrets.get(SecretNamespace.harness('acp-fake'), 'FAKE_TOKEN'))!).toString()).toBe('s3cret');

    // Enabling brings the provider up with the agent — signed out (terminal method), so no models yet.
    await svc['opts'].provider();
    const enabled = (await request(app).put('/api/acp/agents/fake/enabled').send({ enabled: true }).expect(200)).body as AcpAgentsResponse;
    expect(enabled.agents.find((a) => a.id === 'fake')!.enabled).toBe(true);
    expect(onCatalogChange).toHaveBeenCalled();
    expect(provider!.agentIds()).toEqual(['fake']);
    expect(await provider!.getModels()).toEqual([]);
    const status = ((await request(app).get('/api/acp/agents').expect(200)).body as AcpAgentsResponse).agents.find((a) => a.id === 'fake')!.status!;
    expect(status).toMatchObject({ connected: true, authState: 'unauthenticated', ready: false });
    expect(status.authMethods).toEqual([{ id: 'cli', name: 'Sign in from a terminal', type: 'terminal', args: ['--login'], env: { FAKE_LOGIN_MODE: '1' } }]);

    // The agent method route refuses a terminal method; the terminal spec is the agent's own launch + args/env.
    await request(app).post('/api/acp/agents/fake/authenticate').send({ methodId: 'cli' }).expect(409);
    const spec = (await request(app).post('/api/acp/agents/fake/terminal-auth').send({ methodId: 'cli' }).expect(200)).body as AcpTerminalAuthSpec;
    expect(spec.command).toBe(path.join(dir, 'acp', 'agents', 'fake', '1.0.0', 'bin', WIN ? 'fake.cmd' : 'fake'));
    expect(spec.args).toEqual(['--login']);
    expect(spec.env).toMatchObject({ FAKE_TOKEN: 's3cret', FAKE_LOGIN_MODE: '1' });
    expect(spec.posixCommandLine).toContain('--login');
    expect(spec.powershellCommandLine).toMatch(/^\$env:/);

    if (!WIN) {
      // Run it the way a terminal would; then reinitialize: signed in, models listed with subProvider.
      const { execFileSync } = await import('node:child_process');
      execFileSync(spec.command, spec.args, { cwd: spec.cwd, env: { ...process.env, ...spec.env } });
      const after = (await request(app).post('/api/acp/agents/fake/reinitialize').expect(200)).body as AcpAgentsResponse;
      expect(after.agents.find((a) => a.id === 'fake')!.status).toMatchObject({ authState: 'authenticated', ready: true, modelCount: 1 });
      expect((await provider!.getModels()).map((m) => [m.id, m.subProvider])).toEqual([['fake', 'fake']]);
      const test = (await request(app).post('/api/acp/agents/fake/test').expect(200)).body;
      expect(test).toMatchObject({ ok: true, modelCount: 1, authState: 'authenticated', agentInfo: { name: 'fake-acp-agent' } });
    }

    // A newer registry version is an update; uninstall stops and removes it.
    bump('1.1.0');
    await request(app).post('/api/acp/registry/refresh').expect(200);
    const listed = (await request(app).get('/api/acp/agents').expect(200)).body as AcpAgentsResponse;
    expect(listed.agents.find((a) => a.id === 'fake')).toMatchObject({ version: '1.1.0', updateAvailable: true, installed: { version: '1.0.0' } });
    const gone = (await request(app).delete('/api/acp/agents/fake/install').expect(200)).body as AcpAgentsResponse;
    expect(gone.agents.find((a) => a.id === 'fake')).toMatchObject({ installed: null, enabled: false });
    expect(provider!.agentIds()).toEqual([]);
  }, 60_000);

  it('adds and removes a custom agent (ACP-10), which runs at once; unknown agents and bad bodies are refused', async () => {
    const { app, svc } = await setup();
    await svc['opts'].provider();
    const added = (await request(app).post('/api/acp/custom').send({ name: 'My Agent', command: process.execPath, args: [FIXTURE], env: { FAKE_ACP_MODELS: '1' } }).expect(201))
      .body as AcpAgentsResponse;
    const custom = added.agents.find((a) => a.custom)!;
    expect(custom).toMatchObject({ name: 'My Agent', enabled: true, command: { command: process.execPath, args: [FIXTURE] }, env: [{ name: 'FAKE_ACP_MODELS', set: true }] });
    expect(custom.id).toMatch(/^custom-my-agent-/);
    expect((await provider!.getModels()).map((m) => m.id)).toEqual([`${custom.id}/fast`, `${custom.id}/smart`]);

    await request(app).delete(`/api/acp/custom/${custom.id}`).expect(200);
    expect(provider!.agentIds()).toEqual([]);
    await request(app).delete('/api/acp/custom/custom-nope').expect(404);
    await request(app).put('/api/acp/agents/nope/enabled').send({ enabled: true }).expect(404);
    await request(app).put('/api/acp/agents/fake/enabled').send({ enabled: 'yes' }).expect(400);
    await request(app).post('/api/acp/agents/pyonly/install').expect(404); // not in the snapshot-free registry yet
    await request(app).post('/api/acp/custom').send({ name: '', command: 'x' }).expect(400);
  }, 30_000);
});

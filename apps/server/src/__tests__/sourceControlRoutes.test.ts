// ────────────────────────────────────────────────────────────────
// /api/source-control/* — accounts, settings, device sign-in (doc §2)
//
// The config service owns the behaviour; these pin the HTTP contract: the
// composed settings payload, what the route refuses before the service is
// ever called, the 201/204 codes — and, above all, that a token handed in
// never comes back out of any response.
// ────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ValidationError } from '@generatorai/shared';

import { createSourceControlRoutes } from '../routes/sourceControl.js';
import { createErrorMiddleware } from '../middleware/errorHandler.js';

const getSettings = vi.fn();
const updateSettings = vi.fn();
const providerInfo = vi.fn();
const addAccount = vi.fn();
const removeAccount = vi.fn();
const startDeviceLogin = vi.fn();
const getDeviceLogin = vi.fn();
const getConfig = vi.fn();
const setConfig = vi.fn();
const listEditors = vi.fn();
const getActiveProviderId = vi.fn();

/** A token that would be unmistakable if it ever leaked into a response. */
const SECRET = 'ghp_LEAKEDTOKENVALUE0123456789abcdef';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeApp() {
  const container = {
    sourceControlConfigService: {
      getSettings,
      updateSettings,
      providerInfo,
      addAccount,
      removeAccount,
      startDeviceLogin,
      getDeviceLogin,
      getConfig,
      setConfig,
    },
    sourceControlService: { getActiveProviderId },
    editorLauncherService: { listEditors },
    logger,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/source-control', createSourceControlRoutes(container as never));
  // The real app's error middleware, so a service-thrown ValidationError maps
  // the same way here as it does in production (category `validation` → 400).
  app.use(createErrorMiddleware(logger as never));
  return app;
}

const SETTINGS = {
  accounts: [
    {
      id: 'a1',
      provider: 'github',
      label: 'octocat @ github.com',
      login: 'octocat',
      authMethod: 'token',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  defaultAccountId: 'a1',
  generation: { provider: 'copilot', model: 'gpt-5' },
  editor: { defaultEditor: 'vscode' },
  defaultBase: 'main',
};

beforeEach(() => {
  for (const fn of [
    getSettings, updateSettings, providerInfo, addAccount, removeAccount,
    startDeviceLogin, getDeviceLogin, getConfig, setConfig, listEditors,
    getActiveProviderId,
  ]) {
    fn.mockReset();
  }
  getSettings.mockReturnValue(SETTINGS);
  providerInfo.mockResolvedValue([{ id: 'github', name: 'GitHub', loginMethods: ['token'] }]);
  listEditors.mockResolvedValue([
    { id: 'vscode', name: 'VS Code', available: true, scheme: 'vscode' },
  ]);
  getActiveProviderId.mockReturnValue('github');
});

describe('GET /api/source-control/settings', () => {
  it('composes settings, providers and editors into one payload', async () => {
    const res = await request(makeApp()).get('/api/source-control/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settings: SETTINGS,
      providers: [{ id: 'github', name: 'GitHub', loginMethods: ['token'] }],
      editors: [{ id: 'vscode', name: 'VS Code', available: true, scheme: 'vscode' }],
    });
  });
});

describe('PUT /api/source-control/settings', () => {
  it('forwards only the keys that were sent', async () => {
    updateSettings.mockResolvedValue(SETTINGS);
    const res = await request(makeApp())
      .put('/api/source-control/settings')
      .send({ defaultAccountId: 'a1', editor: { defaultEditor: null }, defaultBase: '  dev  ' });

    expect(res.status).toBe(200);
    expect(updateSettings).toHaveBeenCalledWith({
      defaultAccountId: 'a1',
      editor: { defaultEditor: null },
      defaultBase: 'dev',
    });
    // `generation` was absent, so it must not be part of the partial at all —
    // an explicit `{}` would still be a write.
    expect(updateSettings.mock.calls[0]![0]).not.toHaveProperty('generation');
  });

  it.each([
    ['an unknown defaultEditor', { editor: { defaultEditor: 'emacs' } }],
    ['a non-string generation.provider', { generation: { provider: 7 } }],
    ['a non-string generation.model', { generation: { model: [] } }],
    ['a non-object generation', { generation: 'copilot' }],
    ['a non-string defaultAccountId', { defaultAccountId: 12 }],
    ['a blank defaultBase', { defaultBase: '   ' }],
  ])('refuses %s with VALIDATION_ERROR and never calls the service', async (_label, body) => {
    const res = await request(makeApp()).put('/api/source-control/settings').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('accepts a null defaultEditor and a null defaultBase', async () => {
    updateSettings.mockResolvedValue(SETTINGS);
    const res = await request(makeApp())
      .put('/api/source-control/settings')
      .send({ editor: { defaultEditor: null }, defaultBase: null });
    expect(res.status).toBe(200);
    expect(updateSettings).toHaveBeenCalledWith({
      editor: { defaultEditor: null },
      defaultBase: null,
    });
  });

  it('maps a ValidationError from the service onto 400', async () => {
    updateSettings.mockRejectedValue(new ValidationError('Unknown source-control account: zz'));
    const res = await request(makeApp())
      .put('/api/source-control/settings')
      .send({ defaultAccountId: 'zz' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Unknown source-control account');
  });
});

describe('POST /api/source-control/accounts', () => {
  it('creates the account and answers 201 with the client-safe record', async () => {
    addAccount.mockResolvedValue(SETTINGS.accounts[0]);
    const res = await request(makeApp())
      .post('/api/source-control/accounts')
      .send({ provider: 'github', method: 'token', token: SECRET, label: 'work' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(SETTINGS.accounts[0]);
    expect(addAccount).toHaveBeenCalledWith({
      provider: 'github',
      method: 'token',
      token: SECRET,
      label: 'work',
    });
  });

  it('never echoes the token — not in the body, not in a log line', async () => {
    addAccount.mockResolvedValue(SETTINGS.accounts[0]);
    const ok = await request(makeApp())
      .post('/api/source-control/accounts')
      .send({ provider: 'github', method: 'token', token: SECRET });
    expect(JSON.stringify(ok.body)).not.toContain(SECRET);

    // …and the same on the failure path, where the temptation to quote the
    // input back is strongest.
    addAccount.mockRejectedValue(new ValidationError(`Token rejected by the host: ${SECRET}`));
    const bad = await request(makeApp())
      .post('/api/source-control/accounts')
      .send({ provider: 'github', method: 'token', token: SECRET });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain(SECRET);

    const logged = [...logger.info.mock.calls, ...logger.error.mock.calls, ...logger.warn.mock.calls];
    expect(JSON.stringify(logged)).not.toContain(SECRET);
  });

  it.each([
    ['a missing token for method=token', { provider: 'github', method: 'token' }],
    ['a blank token for method=token', { provider: 'github', method: 'token', token: '   ' }],
    ['an unknown provider', { provider: 'gitlab', method: 'token', token: 'x' }],
    ['a missing provider', { method: 'token', token: 'x' }],
    ['an unknown method', { provider: 'github', method: 'ssh' }],
    ['a non-string host', { provider: 'github', method: 'gh-cli', host: 5 }],
  ])('refuses %s with VALIDATION_ERROR', async (_label, body) => {
    const res = await request(makeApp()).post('/api/source-control/accounts').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(addAccount).not.toHaveBeenCalled();
  });

  it('allows gh-cli sign-in without a token', async () => {
    addAccount.mockResolvedValue(SETTINGS.accounts[0]);
    const res = await request(makeApp())
      .post('/api/source-control/accounts')
      .send({ provider: 'github', method: 'gh-cli' });
    expect(res.status).toBe(201);
    expect(addAccount).toHaveBeenCalledWith({ provider: 'github', method: 'gh-cli' });
  });
});

describe('DELETE /api/source-control/accounts/:id', () => {
  it('removes the account and answers 204 with no body', async () => {
    removeAccount.mockResolvedValue(undefined);
    const res = await request(makeApp()).delete('/api/source-control/accounts/a1');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(removeAccount).toHaveBeenCalledWith('a1');
  });
});

describe('device sign-in', () => {
  it('starts a login', async () => {
    startDeviceLogin.mockResolvedValue({
      loginId: 'L1', userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5,
    });
    const res = await request(makeApp())
      .post('/api/source-control/accounts/device/start')
      .send({ provider: 'github' });
    expect(res.status).toBe(200);
    expect(res.body.userCode).toBe('ABCD-1234');
    expect(startDeviceLogin).toHaveBeenCalledWith({ provider: 'github' });
  });

  it('refuses an unknown provider', async () => {
    const res = await request(makeApp())
      .post('/api/source-control/accounts/device/start')
      .send({ provider: 'gitlab' });
    expect(res.status).toBe(400);
    expect(startDeviceLogin).not.toHaveBeenCalled();
  });

  it('reports the status of a live login', async () => {
    getDeviceLogin.mockReturnValue({ loginId: 'L1', status: 'pending' });
    const res = await request(makeApp()).get('/api/source-control/accounts/device/L1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ loginId: 'L1', status: 'pending' });
  });

  it('404s an unknown login id', async () => {
    getDeviceLogin.mockReturnValue(null);
    const res = await request(makeApp()).get('/api/source-control/accounts/device/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('legacy surface', () => {
  it('still answers GET /config', async () => {
    getConfig.mockReturnValue({
      activeProvider: 'github',
      availableProviders: ['github'],
      github: { configured: true },
    });
    const res = await request(makeApp()).get('/api/source-control/config');
    expect(res.status).toBe(200);
    expect(res.body.activeProvider).toBe('github');
  });

  it('still answers PUT /config and refuses an unknown provider', async () => {
    setConfig.mockResolvedValue({ activeProvider: 'none', availableProviders: ['github'], github: { configured: false } });
    const ok = await request(makeApp())
      .put('/api/source-control/config')
      .send({ activeProvider: 'none' });
    expect(ok.status).toBe(200);
    expect(setConfig).toHaveBeenCalledWith({ activeProvider: 'none', github: undefined });

    const bad = await request(makeApp())
      .put('/api/source-control/config')
      .send({ activeProvider: 'gitlab' });
    expect(bad.status).toBe(400);
  });

  it('reports status.enabled as "at least one account is connected"', async () => {
    const connected = await request(makeApp()).get('/api/source-control/status');
    expect(connected.body).toEqual({ activeProvider: 'github', enabled: true });

    getSettings.mockReturnValue({ ...SETTINGS, accounts: [] });
    getActiveProviderId.mockReturnValue('none');
    const empty = await request(makeApp()).get('/api/source-control/status');
    expect(empty.body).toEqual({ activeProvider: 'none', enabled: false });
  });
});

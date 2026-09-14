import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { MemorySecretStore, SecretNamespace } from '@generatorai/secrets';
import { SourceControlRegistry } from '@generatorai/source-control';
import type { IScmHttpClient, IScmProcessRunner } from '@generatorai/source-control';
import { SourceControlConfigService } from '../SourceControlConfigService.js';
import { silentLogger } from './helpers.js';

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

function fakeHttp(opts: { userStatus?: number } = {}): IScmHttpClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async request(options) {
      calls.push(options.url);
      if (options.url.endsWith('/user')) {
        const status = opts.userStatus ?? 200;
        const headers: Record<string, string> = { 'x-oauth-scopes': 'repo, workflow' };
        return {
          status,
          headers,
          body:
            status === 200
              ? JSON.stringify({ login: 'octocat', avatar_url: 'https://x/a.png' })
              : JSON.stringify({ message: 'Bad credentials' }),
        };
      }
      return { status: 404, headers: {} as Record<string, string>, body: '{}' };
    },
  };
}

function fakeRunner(opts: { ghVersion?: boolean; ghToken?: string | null } = {}): IScmProcessRunner {
  return {
    run: vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'gh' && args[0] === '--version') {
        return opts.ghVersion ? { exitCode: 0, stdout: 'gh 2.0.0', stderr: '' } : { exitCode: 127, stdout: '', stderr: '' };
      }
      if (cmd === 'gh' && args[0] === 'auth' && args[1] === 'token') {
        return opts.ghToken
          ? { exitCode: 0, stdout: `${opts.ghToken}\n`, stderr: '' }
          : { exitCode: 1, stdout: '', stderr: 'not logged in' };
      }
      return { exitCode: 127, stdout: '', stderr: '' };
    }),
  };
}

describe('SourceControlConfigService', () => {
  let dir: string;
  let secrets: MemorySecretStore;
  let registry: SourceControlRegistry;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scm-config-'));
    secrets = new MemorySecretStore();
    registry = new SourceControlRegistry();
  });

  afterEach(async () => {
    delete process.env['GENERATORAI_GITHUB_OAUTH_CLIENT_ID'];
    await fs.rm(dir, { recursive: true, force: true });
  });

  function make(env?: { githubToken?: string; githubHost?: string; oauthClientId?: string }, runner = fakeRunner()) {
    return new SourceControlConfigService(registry, {
      http: fakeHttp(),
      processRunner: runner,
      secrets,
      logger: silentLogger,
      configDir: dir,
      ...(env ? { env } : {}),
    });
  }

  async function readFile(): Promise<string> {
    return fs.readFile(path.join(dir, 'source-control.json'), 'utf-8');
  }

  it('starts empty when there is no file', async () => {
    const svc = make();
    await svc.load();
    expect(svc.getSettings()).toEqual({
      accounts: [],
      defaultAccountId: null,
      generation: { provider: null, model: null },
      editor: { defaultEditor: null },
      defaultBase: null,
    });
    expect(svc.getConfig().activeProvider).toBe('none');
    expect(svc.getConfig().github.configured).toBe(false);
  });

  it('migrates a legacy file and moves the token out of it', async () => {
    await fs.writeFile(
      path.join(dir, 'source-control.json'),
      JSON.stringify({
        activeProvider: 'github',
        github: { token: TOKEN, host: 'https://ghe.acme.com', defaultBase: 'develop' },
      }),
      'utf-8',
    );
    const svc = make();
    await svc.load();

    const settings = svc.getSettings();
    expect(settings.accounts).toHaveLength(1);
    expect(settings.accounts[0]).toMatchObject({
      id: 'legacy-github',
      provider: 'github',
      label: 'github',
      host: 'https://ghe.acme.com',
      authMethod: 'token',
    });
    expect(settings.defaultAccountId).toBe('legacy-github');
    expect(settings.defaultBase).toBe('develop');

    // The token moved to the secret store…
    const stored = await secrets.get(SecretNamespace.sourceControl('legacy-github'), 'token');
    expect(stored && new TextDecoder().decode(stored)).toBe(TOKEN);

    // …and is nowhere in the persisted file.
    const raw = await readFile();
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain('"token":');
    expect(JSON.parse(raw)).toMatchObject({ version: 2 });

    // The migrated account is registered and is the default.
    expect(registry.getAccount('legacy-github')).not.toBeNull();
    expect(registry.getDefaultAccountId()).toBe('legacy-github');
    expect(svc.getConfig()).toMatchObject({
      activeProvider: 'github',
      github: { configured: true, host: 'https://ghe.acme.com', defaultBase: 'develop' },
    });
  });

  it('seeds an account from the env token when nothing is configured', async () => {
    const svc = make({ githubToken: TOKEN });
    await svc.load();
    expect(svc.getSettings().accounts[0]).toMatchObject({ id: 'env-github', authMethod: 'token' });
    expect(await readFile()).not.toContain(TOKEN);
  });

  it('round-trips the v2 file and never carries a token in getSettings', async () => {
    const first = make();
    await first.load();
    const account = await first.addAccount({ provider: 'github', method: 'token', token: TOKEN });
    await first.updateSettings({
      generation: { provider: 'claude-agent', model: 'sonnet' },
      editor: { defaultEditor: 'cursor' },
      defaultBase: 'main',
    });

    expect(JSON.stringify(first.getSettings())).not.toContain(TOKEN);
    expect(await readFile()).not.toContain(TOKEN);

    const second = new SourceControlConfigService(new SourceControlRegistry(), {
      http: fakeHttp(),
      processRunner: fakeRunner(),
      secrets,
      logger: silentLogger,
      configDir: dir,
    });
    await second.load();
    expect(second.getSettings().accounts.map((a) => a.id)).toEqual([account.id]);
    expect(second.generation()).toEqual({ provider: 'claude-agent', model: 'sonnet' });
    expect(second.defaultEditor()).toBe('cursor');
    expect(second.defaultBase()).toBe('main');
  });

  it('validates the token with getAuthenticatedUser and records the login', async () => {
    const svc = make();
    await svc.load();
    const account = await svc.addAccount({ provider: 'github', method: 'token', token: TOKEN });
    expect(account).toMatchObject({
      provider: 'github',
      login: 'octocat',
      avatarUrl: 'https://x/a.png',
      scopes: ['repo', 'workflow'],
      authMethod: 'token',
      label: 'octocat @ github.com',
    });
    expect(registry.providerForAccount(account.id)).not.toBeNull();
  });

  it('does not store the token or the account when authentication fails', async () => {
    const svc = new SourceControlConfigService(registry, {
      http: fakeHttp({ userStatus: 401 }),
      processRunner: fakeRunner(),
      secrets,
      logger: silentLogger,
      configDir: dir,
    });
    await svc.load();
    await expect(
      svc.addAccount({ provider: 'github', method: 'token', token: TOKEN }),
    ).rejects.toThrow(/Could not authenticate with github\.com/);
    expect(svc.getSettings().accounts).toEqual([]);
    expect(await secrets.list('source-control/')).toEqual([]);
    expect(registry.listAccounts()).toEqual([]);
  });

  it('rejects a token sign-in with no token', async () => {
    const svc = make();
    await svc.load();
    await expect(svc.addAccount({ provider: 'github', method: 'token' })).rejects.toThrow(
      /personal access token is required/,
    );
  });

  it('imports the gh CLI token, and explains when there is none', async () => {
    const withGh = make(undefined, fakeRunner({ ghToken: TOKEN }));
    await withGh.load();
    const account = await withGh.addAccount({ provider: 'github', method: 'gh-cli' });
    expect(account.authMethod).toBe('gh-cli');

    const withoutGh = make(undefined, fakeRunner({ ghToken: null }));
    await expect(
      withoutGh.addAccount({ provider: 'github', method: 'gh-cli' }),
    ).rejects.toThrow(/gh auth login/);
  });

  it('removes an account, its token and the default pointer', async () => {
    const svc = make();
    await svc.load();
    const first = await svc.addAccount({ provider: 'github', method: 'token', token: TOKEN });
    const second = await svc.addAccount({ provider: 'github', method: 'token', token: TOKEN });
    expect(svc.getSettings().defaultAccountId).toBe(first.id);

    await svc.removeAccount(first.id);
    expect(svc.getSettings().accounts.map((a) => a.id)).toEqual([second.id]);
    expect(svc.getSettings().defaultAccountId).toBe(second.id);
    expect(await secrets.get(SecretNamespace.sourceControl(first.id), 'token')).toBeNull();

    await svc.removeAccount(second.id);
    expect(svc.getSettings().defaultAccountId).toBeNull();
    expect(svc.getConfig().activeProvider).toBe('none');
  });

  it('reports the login methods the server can actually run', async () => {
    const plain = make(undefined, fakeRunner({ ghVersion: false }));
    expect(await plain.providerInfo()).toEqual([
      { id: 'github', name: 'GitHub', loginMethods: ['token'] },
    ]);

    const full = make({ oauthClientId: 'Iv1.abc' }, fakeRunner({ ghVersion: true }));
    expect((await full.providerInfo())[0]!.loginMethods).toEqual(['token', 'device', 'gh-cli']);

    process.env['GENERATORAI_GITHUB_OAUTH_CLIENT_ID'] = 'Iv1.env';
    const fromEnv = make(undefined, fakeRunner({ ghVersion: false }));
    expect((await fromEnv.providerInfo())[0]!.loginMethods).toEqual(['token', 'device']);
  });

  it('caches the gh probe for 60s', async () => {
    const runner = fakeRunner({ ghVersion: true });
    const svc = make(undefined, runner);
    await svc.providerInfo();
    await svc.providerInfo();
    const probes = (runner.run as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'gh' && (c[1] as string[])[0] === '--version',
    );
    expect(probes).toHaveLength(1);
  });

  it('refuses device sign-in when no OAuth client id is configured', async () => {
    const svc = make();
    await svc.load();
    await expect(svc.startDeviceLogin({ provider: 'github' })).rejects.toThrow(
      /GENERATORAI_GITHUB_OAUTH_CLIENT_ID/,
    );
    expect(svc.getDeviceLogin('nope')).toBeNull();
  });

  it('rejects an unknown default account', async () => {
    const svc = make();
    await svc.load();
    await expect(svc.updateSettings({ defaultAccountId: 'ghost' })).rejects.toThrow(
      /Unknown source-control account/,
    );
  });

  it('keeps the legacy setConfig shims working', async () => {
    const svc = make();
    await svc.load();

    await svc.setConfig({ github: { token: TOKEN, host: undefined } });
    expect(svc.getConfig()).toMatchObject({ activeProvider: 'github', github: { configured: true } });

    await svc.setConfig({ github: { defaultBase: 'develop' } });
    expect(svc.getConfig().github.defaultBase).toBe('develop');

    await svc.setConfig({ github: { token: null } });
    expect(svc.getConfig()).toMatchObject({ activeProvider: 'none', github: { configured: false } });
    expect(await readFile()).not.toContain(TOKEN);
  });
});

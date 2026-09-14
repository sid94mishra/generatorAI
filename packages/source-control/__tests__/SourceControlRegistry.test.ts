import { describe, it, expect, vi } from 'vitest';
import { SourceControlRegistry, normalizeHost } from '../src/SourceControlRegistry.js';
import { ghCliToken } from '../src/ghCli.js';
import { createProvider } from '../src/providerFactory.js';
import type { ISourceControlProvider, IScmHttpClient, IScmProcessRunner } from '../src/ports.js';
import type { SourceControlAccount } from '../src/types.js';
import type { ILogger } from '@generatorai/shared';

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

const noopHttp: IScmHttpClient = {
  request: async () => ({ status: 200, headers: {}, body: '{}' }),
};

/** A labelled stand-in for a provider instance. */
function fakeProvider(tag: string): ISourceControlProvider & { tag: string } {
  return { id: 'github', tag } as unknown as ISourceControlProvider & { tag: string };
}

function account(id: string, host?: string): SourceControlAccount {
  return {
    id,
    provider: 'github',
    label: host ? `${id} @ ${host}` : `${id} @ github.com`,
    ...(host ? { host } : {}),
    authMethod: 'token',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('normalizeHost', () => {
  it('parses hosts leniently and defaults to github.com', () => {
    expect(normalizeHost(undefined)).toBe('github.com');
    expect(normalizeHost('')).toBe('github.com');
    expect(normalizeHost('https://GHE.acme.com/api/v3/')).toBe('ghe.acme.com');
    expect(normalizeHost({ host: 'ghe.acme.com' })).toBe('ghe.acme.com');
    expect(normalizeHost('https://www.github.com')).toBe('github.com');
  });
});

describe('SourceControlRegistry accounts', () => {
  function twoAccounts() {
    const reg = new SourceControlRegistry();
    const dotCom = fakeProvider('dotcom');
    const ghe = fakeProvider('ghe');
    reg.registerAccount(account('a1'), dotCom);
    reg.registerAccount(account('a2', 'https://ghe.acme.com'), ghe);
    return { reg, dotCom, ghe };
  }

  it('resolves each account by host', () => {
    const { reg, dotCom, ghe } = twoAccounts();
    expect(reg.providerFor('github.com')).toBe(dotCom);
    expect(reg.providerFor({ host: 'ghe.acme.com' })).toBe(ghe);
    expect(reg.accountFor('ghe.acme.com')?.id).toBe('a2');
    expect(reg.providerForAccount('a2')).toBe(ghe);
    expect(reg.providerForAccount('nope')).toBeNull();
  });

  it('falls back to the default account for an unknown host', () => {
    const { reg, dotCom, ghe } = twoAccounts();
    expect(reg.providerFor('gitlab.example.com')).toBe(dotCom); // first account is default
    reg.setDefault('a2');
    expect(reg.getDefaultAccountId()).toBe('a2');
    expect(reg.providerFor('gitlab.example.com')).toBe(ghe);
    // Host matching still wins over the default.
    expect(reg.providerFor('github.com')).toBe(dotCom);
  });

  it('prefers the default account when two accounts share a host', () => {
    const reg = new SourceControlRegistry();
    const first = fakeProvider('first');
    const second = fakeProvider('second');
    reg.registerAccount(account('a1'), first);
    reg.registerAccount(account('a2'), second);
    expect(reg.providerFor('github.com')).toBe(first);
    reg.setDefault('a2');
    expect(reg.providerFor('github.com')).toBe(second);
  });

  it('lists, reads and removes accounts', () => {
    const { reg } = twoAccounts();
    expect(reg.listAccounts().map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(reg.getAccount('a1')?.label).toBe('a1 @ github.com');
    reg.removeAccount('a1');
    expect(reg.listAccounts().map((a) => a.id)).toEqual(['a2']);
    expect(reg.getAccount('a1')).toBeNull();
    // The default moved off the removed account.
    expect(reg.getDefaultAccountId()).toBe('a2');
    reg.removeAccount('a2');
    expect(reg.listAccounts()).toEqual([]);
    expect(reg.getDefaultAccountId()).toBeNull();
    expect(reg.providerFor('github.com')).toBeNull();
  });

  it('ignores setDefault for an unknown id and accepts null', () => {
    const { reg } = twoAccounts();
    reg.setDefault('missing');
    expect(reg.getDefaultAccountId()).toBe('a1');
    reg.setDefault(null);
    expect(reg.getDefaultAccountId()).toBeNull();
    // Still resolves by host, and falls back to the first account.
    expect(reg.providerFor('ghe.acme.com')?.id).toBe('github');
    expect(reg.providerFor('unknown.host')).not.toBeNull();
  });
});

describe('SourceControlRegistry legacy shims', () => {
  it('getActiveProvider uses the bare provider only when no accounts exist', () => {
    const reg = new SourceControlRegistry();
    const bare = fakeProvider('bare');
    reg.register(bare);
    reg.setActive('github');
    expect(reg.getActiveProvider()).toBe(bare);
    expect(reg.getActive()).toBe('github');
    expect(reg.getProvider('github')).toBe(bare);
    expect(reg.listProviderIds()).toEqual(['github']);

    const accountProvider = fakeProvider('account');
    reg.registerAccount(account('a1'), accountProvider);
    expect(reg.getActiveProvider()).toBe(accountProvider);
  });

  it('setActive("none") disables the bare provider', () => {
    const reg = new SourceControlRegistry();
    reg.register(fakeProvider('bare'));
    reg.setActive('none');
    expect(reg.getActiveProvider()).toBeNull();
    expect(reg.getActive()).toBe('none');
    expect(reg.getProvider('github')).toBeNull();
    expect(reg.listProviderIds()).toEqual([]);
  });

  it('getActive reports github once an account is connected, even if active was never set', () => {
    const reg = new SourceControlRegistry();
    expect(reg.getActive()).toBe('none');
    reg.registerAccount(account('a1'), fakeProvider('p'));
    expect(reg.getActive()).toBe('github');
  });
});

describe('createProvider', () => {
  it('builds a GitHubProvider honouring the host', () => {
    const provider = createProvider(
      'github',
      { token: 't', host: 'https://ghe.acme.com' },
      { http: noopHttp, logger: silentLogger },
    );
    expect(provider.id).toBe('github');
  });

  it('throws on an unknown provider id', () => {
    expect(() =>
      createProvider('gitlab' as 'github', {}, { http: noopHttp, logger: silentLogger }),
    ).toThrow(/Unknown source-control provider/);
  });
});

describe('ghCliToken', () => {
  function runner(result: { exitCode: number; stdout: string }): IScmProcessRunner {
    return { run: vi.fn(async () => ({ stderr: '', ...result })) };
  }

  it('returns the trimmed token on success', async () => {
    const r = runner({ exitCode: 0, stdout: 'gho_abc\n' });
    expect(await ghCliToken(r)).toBe('gho_abc');
    expect(r.run).toHaveBeenCalledWith(
      'gh',
      ['auth', 'token'],
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it('passes --hostname for an enterprise host only', async () => {
    const ghe = runner({ exitCode: 0, stdout: 'x' });
    await ghCliToken(ghe, 'https://ghe.acme.com/api/v3');
    expect(ghe.run).toHaveBeenCalledWith(
      'gh',
      ['auth', 'token', '--hostname', 'ghe.acme.com'],
      expect.anything(),
    );

    const dotCom = runner({ exitCode: 0, stdout: 'x' });
    await ghCliToken(dotCom, 'https://github.com');
    expect(dotCom.run).toHaveBeenCalledWith('gh', ['auth', 'token'], expect.anything());
  });

  it('uses the given cwd', async () => {
    const r = runner({ exitCode: 0, stdout: 'x' });
    await ghCliToken(r, undefined, '/repo');
    expect(r.run).toHaveBeenCalledWith(
      'gh',
      ['auth', 'token'],
      expect.objectContaining({ cwd: '/repo' }),
    );
  });

  it('returns null on a non-zero exit, empty output, or a throwing runner', async () => {
    expect(await ghCliToken(runner({ exitCode: 1, stdout: '' }))).toBeNull();
    expect(await ghCliToken(runner({ exitCode: 0, stdout: '   \n' }))).toBeNull();
    const boom: IScmProcessRunner = {
      run: async () => {
        throw new Error('ENOENT');
      },
    };
    expect(await ghCliToken(boom)).toBeNull();
  });
});

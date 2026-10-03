// GitClient.lsRemoteBranches + isRemoteGitUrl (mobile MG-11). A stub runner:
// the real command needs a network remote, and the parser is the part worth
// pinning (default branch first, sorted, capped, failures classified).

import { describe, expect, it } from 'vitest';
import type { ILogger } from '@generatorai/shared';
import { GitClient } from '../src/GitClient.js';
import { isRemoteGitUrl } from '../src/remoteUrl.js';
import type { GitProcessRunOptions, GitProcessRunResult, IGitProcessRunner } from '../src/ports/IGitProcessRunner.js';

const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as ILogger;

function client(result: Partial<GitProcessRunResult> & { timedOut?: boolean }) {
  const calls: Array<{ args: string[]; options: GitProcessRunOptions }> = [];
  const runner: IGitProcessRunner = {
    async run(_cmd, args, options) {
      calls.push({ args, options });
      return { exitCode: 0, stdout: '', stderr: '', durationMs: 1, ...result };
    },
  };
  return { git: new GitClient(runner, logger, { workspacesDir: '/tmp' }), calls };
}

const LS = [
  'ref: refs/heads/main\tHEAD',
  'aaa111\tHEAD',
  'bbb222\trefs/heads/feature/x',
  'aaa111\trefs/heads/main',
  'ccc333\trefs/heads/develop',
].join('\n');

describe('isRemoteGitUrl', () => {
  it('accepts network transports', () => {
    for (const url of [
      'https://github.com/acme/app.git',
      'http://git.local/repo',
      'ssh://git@github.com/acme/app.git',
      'git://example.org/repo.git',
      'git@github.com:acme/app.git',
    ]) expect(isRemoteGitUrl(url), url).toBe(true);
  });

  it('refuses helpers that run commands or read the server disk', () => {
    for (const url of [
      'ext::sh -c touch% /tmp/pwned',
      'file:///etc',
      '/srv/repos/app',
      'C:\\repos\\app',
      'C:/repos/app',
      '--upload-pack=touch /tmp/x',
      '',
      'fd::17',
    ]) expect(isRemoteGitUrl(url), url).toBe(false);
  });
});

describe('GitClient.lsRemoteBranches', () => {
  it('lists branches with the default first, then sorted', async () => {
    const { git, calls } = client({ stdout: LS });
    expect(await git.lsRemoteBranches('https://github.com/acme/app.git')).toEqual({
      ok: true,
      defaultBranch: 'main',
      branches: ['main', 'develop', 'feature/x'],
      truncated: false,
    });
    expect(calls[0]!.args).toEqual([
      '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never',
      'ls-remote', '--symref', '--', 'https://github.com/acme/app.git', 'HEAD', 'refs/heads/*',
    ]);
    expect(calls[0]!.options.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0' });
    expect(calls[0]!.options.timeout).toBe(15_000);
  });

  it('caps the list and says so', async () => {
    const { git } = client({ stdout: LS });
    expect(await git.lsRemoteBranches('https://x.org/r.git', { limit: 2 })).toMatchObject({
      branches: ['main', 'develop'],
      truncated: true,
    });
  });

  it('never runs git for a refused URL', async () => {
    const { git, calls } = client({ stdout: LS });
    expect(await git.lsRemoteBranches('ext::sh -c id')).toMatchObject({ ok: false, reason: 'invalid_url' });
    expect(calls).toHaveLength(0);
  });

  it('classifies failures', async () => {
    expect(await client({ exitCode: 128, stderr: 'fatal: Authentication failed for x' }).git.lsRemoteBranches('https://a.b/c'))
      .toMatchObject({ ok: false, reason: 'auth' });
    expect(await client({ exitCode: 128, stderr: "remote: Repository not found.\nfatal: repository 'x' not found" }).git.lsRemoteBranches('https://a.b/c'))
      .toMatchObject({ ok: false, reason: 'not_found' });
    expect(await client({ exitCode: -1, stderr: 'Process timed out after 15000ms', timedOut: true }).git.lsRemoteBranches('https://a.b/c'))
      .toMatchObject({ ok: false, reason: 'timeout' });
    expect(await client({ exitCode: 2, stderr: 'fatal: something odd' }).git.lsRemoteBranches('https://a.b/c'))
      .toEqual({ ok: false, reason: 'failed', message: 'fatal: something odd' });
  });
});

// U-83: agents commit as the connected GitHub account when git has no identity — and never over the person's own.
// Runs the real git against the generated files, isolated from this machine's config by a temporary HOME.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { GitGlobalConfig, githubCommitIdentity } from '../src/services/scm/gitIdentity.js';

async function sandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gai-git-identity-'));
  const home = path.join(root, 'home');
  await fs.mkdir(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1' };
  const config = new GitGlobalConfig(path.join(root, 'app', 'git'), env);
  const git = (...args: string[]) => {
    try {
      return execFileSync('git', args, { env: env as Record<string, string>, cwd: root, encoding: 'utf-8' }).trim();
    } catch {
      return '';
    }
  };
  return { home, env, config, git };
}

describe('git fallback identity (U-83)', () => {
  it('uses the GitHub noreply address, with the user id when known and the enterprise host', () => {
    expect(githubCommitIdentity({ login: 'octo', userId: 42, displayName: 'Octo Cat' })).toEqual({ name: 'Octo Cat', email: '42+octo@users.noreply.github.com' });
    expect(githubCommitIdentity({ login: 'octo' })).toEqual({ name: 'octo', email: 'octo@users.noreply.github.com' });
    expect(githubCommitIdentity({ login: 'octo', userId: 7 }, 'https://ghe.example.com/api/v3')?.email).toBe('7+octo@users.noreply.ghe.example.com');
    expect(githubCommitIdentity({ login: '' })).toBeNull();
  });

  it('git falls back to the account, and the person’s own ~/.gitconfig wins over it', async () => {
    const { home, env, config, git } = await sandbox();
    await config.install();
    expect(env['GIT_CONFIG_GLOBAL']).toBe(config.configPath);
    expect(git('config', 'user.email')).toBe('');

    await config.setIdentity({ name: 'Octo "The" Cat', email: '42+octo@users.noreply.github.com' });
    expect(git('config', 'user.email')).toBe('42+octo@users.noreply.github.com');
    expect(git('config', 'user.name')).toBe('Octo "The" Cat');

    await fs.writeFile(path.join(home, '.gitconfig'), '[user]\n\temail = me@example.com\n');
    expect(git('config', 'user.email')).toBe('me@example.com');
    expect(git('config', 'user.name')).toBe('Octo "The" Cat');
  });

  it('keeps `git config --global` writes across a reinstall, with one managed header', async () => {
    const { env, config, git } = await sandbox();
    await config.install();
    git('config', '--global', 'pull.rebase', 'true');
    await config.install();
    expect(git('config', 'pull.rebase')).toBe('true');
    const text = await fs.readFile(config.configPath, 'utf-8');
    expect(text.match(/>>> GeneratorAI/g)).toHaveLength(1);
    expect(env['GIT_CONFIG_GLOBAL']).toBe(config.configPath);
  });
});

// The git identity agents and the app commit with when the person has none of their own (U-83).
//
// With no user.name / user.email anywhere, git made one up from the login and the hostname, and agent commits reached
// GitHub as `sidmishra@Siddharths-MacBook-Air.local`, linked to no account. Every process the server starts (agent
// harnesses, terminals, checks, the app's own git) reads git's global config from GIT_CONFIG_GLOBAL, pointed at
// `<configDir>/git/config`:
//
//   [include] path = <configDir>/git/identity   ← the default GitHub account, rewritten by the app
//   [include] path = ~/.config/git/config        ← the person's own global config, read after it,
//   [include] path = ~/.gitconfig                   so anything they set wins
//
// A repository's own config still outranks all of it. `git config --global …` run by an agent or in a terminal
// appends to the outer file after the includes, so it wins and is kept: the app rewrites only its marked header there
// and the identity file. git older than 2.32 ignores GIT_CONFIG_GLOBAL and behaves as before.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface CommitIdentity {
  name: string;
  email: string;
}

/**
 * The connected GitHub account as a commit author: its profile name (else the login) and its private noreply address,
 * which links every commit to the account without publishing a real email — the address GitHub itself uses for
 * web commits when the email is private.
 */
export function githubCommitIdentity(
  account: { login?: string | undefined; userId?: number | undefined; displayName?: string | undefined },
  host?: string,
): CommitIdentity | null {
  const login = account.login?.trim();
  if (!login) return null;
  const local = account.userId ? `${account.userId}+${login}` : login;
  return { name: account.displayName?.trim() || login, email: `${local}@${noreplyDomain(host)}` };
}

/** `users.noreply.github.com`, or `users.noreply.<hostname>` on GitHub Enterprise Server. */
function noreplyDomain(host: string | undefined): string {
  if (!host) return 'users.noreply.github.com';
  let hostname: string;
  try {
    hostname = new URL(host.includes('://') ? host : `https://${host}`).hostname.toLowerCase();
  } catch {
    return 'users.noreply.github.com';
  }
  return hostname === 'github.com' || hostname === 'api.github.com' ? 'users.noreply.github.com' : `users.noreply.${hostname}`;
}

const BEGIN = '# >>> GeneratorAI (managed: the connected account as a fallback identity; your own settings win)';
const END = '# <<< GeneratorAI';

/** A git config string value: quoted, with `\` and `"` escaped (a name may hold either). */
function quoted(value: string): string {
  return `"${value.replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** git reads include paths with forward slashes on every OS; `~/` is expanded by git itself. */
function includePath(p: string): string {
  return quoted(p.replace(/\\/g, '/'));
}

/** The person's own global config files, lowest precedence first (git reads XDG before ~/.gitconfig). */
export function ownGlobalConfigPaths(env: NodeJS.ProcessEnv, managedPath: string): string[] {
  const own = env['GIT_CONFIG_GLOBAL'];
  if (own && path.resolve(own) !== path.resolve(managedPath)) return [own];
  const xdg = env['XDG_CONFIG_HOME'] ? path.join(env['XDG_CONFIG_HOME'], 'git', 'config') : '~/.config/git/config';
  return [xdg, '~/.gitconfig'];
}

/** The outer file's managed header: the identity first, then the person's own files, which therefore win. */
export function managedHeader(identityPath: string, ownPaths: readonly string[]): string {
  const includes = [identityPath, ...ownPaths].map((p) => `[include]\n\tpath = ${includePath(p)}`);
  return [BEGIN, ...includes, END].join('\n');
}

/** Replaces the managed header in `existing` (or puts it first), keeping everything else — `git config --global` writes. */
export function withManagedHeader(existing: string, header: string): string {
  const start = existing.indexOf(BEGIN);
  const end = start >= 0 ? existing.indexOf(END, start) : -1;
  const rest = start >= 0 && end >= 0 ? existing.slice(0, start) + existing.slice(end + END.length) : existing;
  const tail = rest.replace(/^\s+/, '');
  return `${header}\n${tail ? `${tail.replace(/\s*$/, '')}\n` : ''}`;
}

export function identityConfigText(identity: CommitIdentity | null): string {
  if (!identity) return '# No GitHub account is connected: git uses your own identity.\n';
  return `# The default connected GitHub account (Settings → Source control).\n[user]\n\tname = ${quoted(identity.name)}\n\temail = ${quoted(identity.email)}\n`;
}

/** Owns `<dir>/config` (what GIT_CONFIG_GLOBAL names) and `<dir>/identity`. */
export class GitGlobalConfig {
  readonly configPath: string;
  readonly identityPath: string;

  constructor(
    dir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.configPath = path.join(dir, 'config');
    this.identityPath = path.join(dir, 'identity');
  }

  /**
   * Writes the outer file's header and points GIT_CONFIG_GLOBAL at it. Call before the server starts any child: a
   * long-lived one (the Codex app server) keeps the env it started with, and a later identity change is a rewrite of
   * the identity file, which every git invocation reads afresh.
   */
  async install(): Promise<void> {
    const ownPaths = ownGlobalConfigPaths(this.env, this.configPath);
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    const existing = await fs.readFile(this.configPath, 'utf-8').catch(() => '');
    await fs.writeFile(this.configPath, withManagedHeader(existing, managedHeader(this.identityPath, ownPaths)), 'utf-8');
    // Created empty once; `setIdentity` fills it when the accounts load.
    await fs.writeFile(this.identityPath, identityConfigText(null), { flag: 'wx' }).catch(() => {});
    this.env['GIT_CONFIG_GLOBAL'] = this.configPath;
  }

  async setIdentity(identity: CommitIdentity | null): Promise<void> {
    await fs.mkdir(path.dirname(this.identityPath), { recursive: true });
    await fs.writeFile(this.identityPath, identityConfigText(identity), 'utf-8');
  }
}

import { describe, expect, it } from 'vitest';
import {
  BASE_CHILD_ENV_ALLOWLIST,
  buildChildEnv,
  isBlockedChildEnvVar,
} from '../src/config/childEnv.js';

// The threat this module exists for: anything that executes model-authored
// commands can read its whole environment. The load-bearing property is not
// "these specific names are stripped" but "a name nobody allowlisted never
// appears" — a denylist passes the first and fails the second, which is how
// the terminal hosts leaked provider credentials for as long as they did.

const SECRETS: Record<string, string> = {
  GENERATORAI_SECRET_KEY: 'vault-key',
  GENERATORAI_DESKTOP_ADMIN_TOKEN: 'admin-token',
  GENERATORAI_RELAY_TOKEN: 'relay',
  DATABASE_URL: 'postgres://u:p@h/db',
  ANTHROPIC_API_KEY: 'sk-ant',
  OPENAI_API_KEY: 'sk-oai',
  GITHUB_TOKEN: 'ghp_x',
  GH_TOKEN: 'ghp_y',
  AWS_ACCESS_KEY_ID: 'AKIA',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  AWS_SESSION_TOKEN: 'aws-session',
  AZURE_CLIENT_SECRET: 'az',
  GOOGLE_APPLICATION_CREDENTIALS: '/creds.json',
  MY_SERVICE_PASSWORD: 'hunter2',
  SOME_AUTH_TOKEN: 'tok',
  ELECTRON_RUN_AS_NODE: '1',
};

const BENIGN: Record<string, string> = {
  PATH: '/usr/bin',
  HOME: '/home/u',
  LANG: 'en_US.UTF-8',
  TERM: 'xterm-256color',
};

describe('buildChildEnv', () => {
  it('passes through the base allowlist', () => {
    const env = buildChildEnv({ source: { ...BENIGN } });
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['HOME']).toBe('/home/u');
    expect(env['LANG']).toBe('en_US.UTF-8');
  });

  it.each(Object.keys(SECRETS))('never leaks %s', (name) => {
    const env = buildChildEnv({ source: { ...BENIGN, ...SECRETS } });
    expect(env[name]).toBeUndefined();
  });

  // The property that a denylist cannot give you.
  it('omits any variable nobody allowlisted, even an innocuous-looking one', () => {
    const env = buildChildEnv({
      source: { ...BENIGN, TOMORROWS_NEW_INTERNAL_VAR: 'whatever' },
    });
    expect(env['TOMORROWS_NEW_INTERNAL_VAR']).toBeUndefined();
  });

  it('returns only allowlisted names for a full-environment source', () => {
    const env = buildChildEnv({ source: { ...BENIGN, ...SECRETS } });
    for (const name of Object.keys(env)) {
      expect(BASE_CHILD_ENV_ALLOWLIST).toContain(name);
    }
  });

  it('honours explicit passthrough for names a specific child needs', () => {
    const env = buildChildEnv({
      source: { ...BENIGN, CLAUDE_CLI_PATH: '/opt/claude' },
      passthrough: ['CLAUDE_CLI_PATH'],
    });
    expect(env['CLAUDE_CLI_PATH']).toBe('/opt/claude');
  });

  it('refuses to pass a denied name through `passthrough`', () => {
    // Otherwise a caller could re-introduce the very thing the allowlist
    // exists to withhold, just by naming it.
    const env = buildChildEnv({
      source: { ...BENIGN, ...SECRETS },
      passthrough: ['GITHUB_TOKEN', 'GENERATORAI_SECRET_KEY'],
    });
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(env['GENERATORAI_SECRET_KEY']).toBeUndefined();
  });

  it('allows a caller to inject a credential it owns via `extra`', () => {
    // Just-in-time injection is the legitimate path: the caller is stating
    // intent rather than inheriting by accident.
    const env = buildChildEnv({
      source: { ...BENIGN, ...SECRETS },
      extra: { ANTHROPIC_API_KEY: 'fetched-from-vault' },
    });
    expect(env['ANTHROPIC_API_KEY']).toBe('fetched-from-vault');
    // ...but only the one it named.
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['GITHUB_TOKEN']).toBeUndefined();
  });

  it('drops undefined values rather than emitting the string "undefined"', () => {
    const env = buildChildEnv({ source: { ...BENIGN }, extra: { FOO: undefined } });
    expect('FOO' in env).toBe(false);
  });

  it('never returns a prototype-polluting key from the source', () => {
    const env = buildChildEnv({ source: { ...BENIGN, __proto__: 'x' } as never });
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
  });
});

describe('isBlockedChildEnvVar', () => {
  it.each(Object.keys(SECRETS))('reports %s as blocked', (name) => {
    expect(isBlockedChildEnvVar(name)).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isBlockedChildEnvVar('github_token')).toBe(true);
    expect(isBlockedChildEnvVar('Database_Url')).toBe(true);
  });

  it('does not block ordinary shell variables', () => {
    for (const name of ['PATH', 'HOME', 'TERM', 'LANG', 'EDITOR']) {
      expect(isBlockedChildEnvVar(name)).toBe(false);
    }
  });
});

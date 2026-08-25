// ────────────────────────────────────────────────────────────────
// Harness child-environment isolation.
//
// These tests exist because the failure mode is silent and catastrophic: a
// harness runs model-authored shell commands, so anything left in its
// environment is one prompt injection away from being exfiltrated — and
// nothing about the app misbehaves to warn you.
//
// The most important assertion is the last one: a variable nobody has thought
// of yet must be excluded by DEFAULT. An allowlist gives that for free; a
// blocklist would not.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  buildHarnessEnv,
  isBlockedHarnessEnvVar,
  HARNESS_ENV_ALLOWLIST,
} from '../src/childEnv.js';
import { PARENT_PID_ENV, SPAWN_MARKER_ENV } from '../src/childRegistry.js';

/** A parent environment resembling a real GeneratorAI server process. */
const PARENT: NodeJS.ProcessEnv = {
  // Legitimate, needed by the child.
  PATH: '/usr/bin:/bin',
  HOME: '/home/dev',
  LANG: 'en_US.UTF-8',
  HTTPS_PROXY: 'http://corp-proxy:3128',
  // GeneratorAI's own security material.
  GENERATORAI_SECRET_KEY: 'VAULT-KEY-MUST-NOT-LEAK',
  GENERATORAI_DESKTOP_ADMIN_TOKEN: 'ADMIN-TOKEN-MUST-NOT-LEAK',
  GENERATORAI_ELECTRON_IPC_TOKEN: 'IPC-TOKEN-MUST-NOT-LEAK',
  GENERATORAI_API_KEY: 'LEGACY-KEY-MUST-NOT-LEAK',
  // Other providers' credentials.
  ANTHROPIC_API_KEY: 'sk-ant-MUST-NOT-LEAK',
  OPENAI_API_KEY: 'sk-oai-MUST-NOT-LEAK',
  GITHUB_TOKEN: 'ghp-MUST-NOT-LEAK',
  GH_TOKEN: 'gho-MUST-NOT-LEAK',
  // Infrastructure.
  DATABASE_URL: 'postgres://user:pw@host/db',
  AWS_SECRET_ACCESS_KEY: 'aws-MUST-NOT-LEAK',
  // Electron internals.
  ELECTRON_RUN_AS_NODE: '1',
};

/** Every value above that must never appear in a child environment. */
const SECRETS = Object.entries(PARENT)
  .filter(([, v]) => typeof v === 'string' && /MUST-NOT-LEAK|postgres:\/\//.test(v))
  .map(([, v]) => v as string);

function serialise(env: Record<string, string>): string {
  return JSON.stringify(env);
}

describe('buildHarnessEnv', () => {
  it('passes through the variables a child genuinely needs', () => {
    const env = buildHarnessEnv({ source: PARENT });
    expect(env['PATH']).toBe('/usr/bin:/bin');
    expect(env['HOME']).toBe('/home/dev');
    expect(env['LANG']).toBe('en_US.UTF-8');
  });

  it('keeps corporate proxy settings, without which every tool breaks', () => {
    const env = buildHarnessEnv({ source: PARENT });
    expect(env['HTTPS_PROXY']).toBe('http://corp-proxy:3128');
  });

  it('never leaks the vault key that protects every stored credential', () => {
    const env = buildHarnessEnv({ source: PARENT });
    expect(env['GENERATORAI_SECRET_KEY']).toBeUndefined();
    expect(serialise(env)).not.toContain('VAULT-KEY-MUST-NOT-LEAK');
  });

  it('never leaks the desktop admin token, which mints pairing grants', () => {
    const env = buildHarnessEnv({ source: PARENT });
    expect(env['GENERATORAI_DESKTOP_ADMIN_TOKEN']).toBeUndefined();
  });

  it("never leaks another provider's API key", () => {
    const env = buildHarnessEnv({ source: PARENT });
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
  });

  it('never leaks source-control tokens', () => {
    const env = buildHarnessEnv({ source: PARENT });
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(env['GH_TOKEN']).toBeUndefined();
  });

  it('never leaks database or cloud credentials', () => {
    const env = buildHarnessEnv({ source: PARENT });
    expect(env['DATABASE_URL']).toBeUndefined();
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
  });

  it('never leaks Electron internals that could re-enter the shell', () => {
    const env = buildHarnessEnv({ source: PARENT });
    expect(env['ELECTRON_RUN_AS_NODE']).toBeUndefined();
  });

  it('leaks no secret value at all, by any name', () => {
    const serialised = serialise(buildHarnessEnv({ source: PARENT }));
    for (const secret of SECRETS) {
      expect(serialised).not.toContain(secret);
    }
  });

  // ── Just-in-time injection ──────────────────────────────────────

  it('injects the credential this provider was explicitly given', () => {
    // The whole point: Claude receives ITS key, and only because we said so.
    const env = buildHarnessEnv({
      source: PARENT,
      extra: { ANTHROPIC_API_KEY: 'sk-ant-this-instance' },
    });
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-this-instance');
    // …and still not the ambient one it was never meant to see.
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['GITHUB_TOKEN']).toBeUndefined();
  });

  it('injects a per-instance managed home so two accounts stay isolated', () => {
    const work = buildHarnessEnv({
      source: PARENT,
      extra: { CLAUDE_CONFIG_DIR: '/data/harnesses/claude-work/home' },
    });
    const personal = buildHarnessEnv({
      source: PARENT,
      extra: { CLAUDE_CONFIG_DIR: '/data/harnesses/claude-personal/home' },
    });
    expect(work['CLAUDE_CONFIG_DIR']).not.toBe(personal['CLAUDE_CONFIG_DIR']);
  });

  it('drops undefined values rather than passing "undefined" strings', () => {
    const env = buildHarnessEnv({ source: PARENT, extra: { SOME_VAR: undefined } });
    expect('SOME_VAR' in env).toBe(false);
  });

  // ── Passthrough ─────────────────────────────────────────────────

  it('passes through named operator settings on request', () => {
    const env = buildHarnessEnv({
      source: { ...PARENT, CLAUDE_CLI_PATH: '/usr/local/bin/claude' },
      passthrough: ['CLAUDE_CLI_PATH'],
    });
    expect(env['CLAUDE_CLI_PATH']).toBe('/usr/local/bin/claude');
  });

  it('refuses to pass through a credential even when explicitly named', () => {
    // A provider must not be able to widen its own access by listing a
    // secret in `passthrough` — that would defeat the whole design.
    const env = buildHarnessEnv({
      source: PARENT,
      passthrough: ['GENERATORAI_SECRET_KEY', 'GITHUB_TOKEN'],
    });
    expect(env['GENERATORAI_SECRET_KEY']).toBeUndefined();
    expect(env['GITHUB_TOKEN']).toBeUndefined();
  });

  // ── The property that actually matters long-term ────────────────

  it('excludes an unknown future variable by default', () => {
    // This is the regression this whole module exists to prevent: someone
    // adds `GENERATORAI_BILLING_SECRET` to the server next year and it must
    // NOT silently start flowing into every agent.
    const env = buildHarnessEnv({
      source: { ...PARENT, SOME_FUTURE_CREDENTIAL: 'future-secret' },
    });
    expect(env['SOME_FUTURE_CREDENTIAL']).toBeUndefined();
    expect(serialise(env)).not.toContain('future-secret');
  });

  it('exposes only allowlisted names, plus the two provenance markers', () => {
    const env = buildHarnessEnv({ source: PARENT });
    for (const name of Object.keys(env)) {
      if (name === SPAWN_MARKER_ENV || name === PARENT_PID_ENV) continue;
      expect(HARNESS_ENV_ALLOWLIST).toContain(name);
    }
  });

  it('stamps provenance so the boot reaper can tell our children from the user\u2019s', () => {
    const env = buildHarnessEnv({ source: PARENT });
    // Carries no authority: a boot id and a pid, both already visible in any
    // process listing. They exist so an orphan can be attributed, and are
    // asserted here so nobody "tidies" them away.
    expect(env[SPAWN_MARKER_ENV]).toBeTruthy();
    expect(env[PARENT_PID_ENV]).toBe(String(process.pid));
  });
});

describe('isBlockedHarnessEnvVar', () => {
  it.each([
    'GENERATORAI_SECRET_KEY',
    'GENERATORAI_ADMIN_TOKEN',
    'ANTHROPIC_API_KEY',
    'GITHUB_TOKEN',
    'MY_SERVICE_TOKEN',
    'SOME_PASSWORD',
    'APP_PRIVATE_KEY',
    'DATABASE_URL',
    'AWS_SECRET_ACCESS_KEY',
    'ELECTRON_RUN_AS_NODE',
  ])('blocks %s', (name) => {
    expect(isBlockedHarnessEnvVar(name)).toBe(true);
  });

  it.each(['PATH', 'HOME', 'LANG', 'TERM', 'HTTPS_PROXY'])(
    'allows %s',
    (name) => {
      expect(isBlockedHarnessEnvVar(name)).toBe(false);
    },
  );
});

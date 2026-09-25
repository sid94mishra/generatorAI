// ────────────────────────────────────────────────────────────────
// Workspace mounts — `workingDirectory` / `additionalDirectories` / `env`
// ────────────────────────────────────────────────────────────────
//
// A chat is bound to a primary mount plus a set of extra roots (its other
// mounts and its managed workspace root), and the core hands the provider the
// workspace paths as `GENERATORAI_WORKSPACE_ROOT` / `GENERATORAI_SCRATCH_DIR`.
//
// Every one of those is an OPTIONAL field on `CreateConversationParams`, so a
// provider that ignores it still compiles and still passes every other test —
// which is exactly how `additionalDirectories` could have been added to the
// port and quietly dropped by all five adapters. These tests assert the values
// actually reach the SDK options / the child environment.
//
// The Claude cases go through `buildQueryOptions`, the single function whose
// return value IS the SDK `query()` options object, so they pin the value at
// the boundary rather than one hop short of it.

import { describe, expect, it, vi } from 'vitest';
import {
  ClaudeAgentProvider,
  sessionFingerprint,
} from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import { buildHarnessEnv, filterDelegatedHarnessEnv } from '../src/childEnv.js';
import type { CreateConversationParams } from '@generatorai/core';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  startup: vi.fn(async () => { throw new Error('not used'); }),
  deleteSession: vi.fn(),
}));

const PRIMARY = '/work/repo';
const SCRATCH = '/work/.generatorai/chat-1/scratch';
const OTHER_MOUNT = '/work/docs';

/** Reach the private option builder — its output is the SDK's own options bag. */
type Internals = {
  conversations: Map<string, unknown>;
  buildQueryOptions: (config: unknown) => Record<string, unknown>;
};

function makeProvider(): ClaudeAgentProvider {
  return new ClaudeAgentProvider({
    cliPath: '/nonexistent/claude',
    defaultCwd: '/server/cwd',
  } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
}

async function optionsFor(params: CreateConversationParams): Promise<Record<string, unknown>> {
  const provider = makeProvider();
  await provider.createConversation(params);
  const internals = provider as unknown as Internals;
  const config = internals.conversations.get(params.conversationId);
  return internals.buildQueryOptions(config);
}

describe('ClaudeAgentProvider — workspace mounts reach the SDK', () => {
  it('sends the chat\'s primary mount as cwd, not the server\'s cwd', async () => {
    const options = await optionsFor({
      conversationId: 'c1',
      workingDirectory: PRIMARY,
    } as CreateConversationParams);

    expect(options['cwd']).toBe(PRIMARY);
  });

  it('forwards additionalDirectories to the SDK options', async () => {
    const options = await optionsFor({
      conversationId: 'c2',
      workingDirectory: PRIMARY,
      additionalDirectories: [OTHER_MOUNT, SCRATCH],
    } as CreateConversationParams);

    expect(options['additionalDirectories']).toEqual([OTHER_MOUNT, SCRATCH]);
  });

  it('de-duplicates the extra roots and omits the field when there are none', async () => {
    const dupes = await optionsFor({
      conversationId: 'c3',
      additionalDirectories: [SCRATCH, SCRATCH, OTHER_MOUNT],
    } as CreateConversationParams);
    expect(dupes['additionalDirectories']).toEqual([SCRATCH, OTHER_MOUNT]);

    const none = await optionsFor({ conversationId: 'c4' } as CreateConversationParams);
    expect(none['additionalDirectories']).toBeUndefined();
  });

  it('merges the GENERATORAI_* env the core handed down into the child env', async () => {
    const options = await optionsFor({
      conversationId: 'c5',
      workingDirectory: PRIMARY,
      env: {
        GENERATORAI_WORKSPACE_ROOT: '/work/.generatorai/chat-1',
        GENERATORAI_SCRATCH_DIR: SCRATCH,
      },
    } as CreateConversationParams);

    const env = options['env'] as Record<string, string>;
    expect(env['GENERATORAI_WORKSPACE_ROOT']).toBe('/work/.generatorai/chat-1');
    expect(env['GENERATORAI_SCRATCH_DIR']).toBe(SCRATCH);
  });

  it('accepts ONLY GENERATORAI_* names from params.env — never an arbitrary injection', async () => {
    const options = await optionsFor({
      conversationId: 'c6',
      env: {
        GENERATORAI_SCRATCH_DIR: SCRATCH,
        // A caller (or a compromised one) trying to smuggle credentials and
        // loader overrides into a process that runs model-authored commands.
        ANTHROPIC_API_KEY: 'sk-should-never-arrive',
        GITHUB_TOKEN: 'ghp_should-never-arrive',
        LD_PRELOAD: '/tmp/evil.so',
        PATH: '/tmp/evil/bin',
        // Matches the prefix but is on the deny list — the crown jewels.
        GENERATORAI_SECRET_KEY: 'vault-key',
      },
    } as CreateConversationParams);

    const env = options['env'] as Record<string, string>;
    expect(env['GENERATORAI_SCRATCH_DIR']).toBe(SCRATCH);
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(env['LD_PRELOAD']).toBeUndefined();
    expect(env['GENERATORAI_SECRET_KEY']).toBeUndefined();
    expect(env['PATH']).not.toBe('/tmp/evil/bin');
  });

  it('changing the extra roots changes the session fingerprint (forces a rebuild)', async () => {
    // There is no live setter for `additionalDirectories` in SDK 0.3.220, so a
    // chat that gains a mount must start a new session rather than keep
    // running against the roots it was launched with.
    const before = await optionsFor({
      conversationId: 'c7',
      workingDirectory: PRIMARY,
    } as CreateConversationParams);
    const after = await optionsFor({
      conversationId: 'c7',
      workingDirectory: PRIMARY,
      additionalDirectories: [SCRATCH],
    } as CreateConversationParams);

    expect(sessionFingerprint(before as never)).not.toBe(sessionFingerprint(after as never));
  });

  it('declares plugin skills and warns on skill directories, because the SDK has no such option', async () => {
    // SDK `Options` has `skills` (names) and `plugins` (plugin roots); neither
    // takes the staged skill directories, so the composer delivers skills as
    // a local plugin (RV-7) and a directory list is reported, not dropped.
    const provider = makeProvider();
    expect(provider.capabilities().skills).toBe('plugin');

    await provider.createConversation({
      conversationId: 'c8',
      skillDirectories: ['/staged/skills'],
    } as CreateConversationParams);

    expect(provider.getConversationWarnings('c8')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
          params: expect.objectContaining({ field: 'skillDirectories' }),
        }),
      ]),
    );
  });
});

describe('childEnv — delegated per-conversation variables', () => {
  it('keeps GENERATORAI_* names and drops everything else', () => {
    expect(filterDelegatedHarnessEnv({
      GENERATORAI_WORKSPACE_ROOT: '/w',
      GENERATORAI_SCRATCH_DIR: '/w/scratch',
      HOME: '/root',
      OPENAI_API_KEY: 'sk-x',
      generatorai_lowercase: 'no',
    })).toEqual({
      GENERATORAI_WORKSPACE_ROOT: '/w',
      GENERATORAI_SCRATCH_DIR: '/w/scratch',
    });
  });

  it('still applies the deny list — a prefix match is not a free pass', () => {
    expect(filterDelegatedHarnessEnv({
      GENERATORAI_SECRET_KEY: 'vault',
      GENERATORAI_DESKTOP_ADMIN_TOKEN: 'admin',
      GENERATORAI_API_BASE: 'http://x',
      GENERATORAI_SCRATCH_DIR: '/ok',
    })).toEqual({ GENERATORAI_SCRATCH_DIR: '/ok' });
  });

  it('does NOT grant the own-credential exemption `extra` has', () => {
    // `extra` deliberately lets a call site inject a name the deny list would
    // otherwise strike out — that is how just-in-time credential injection
    // works. `delegated` must not inherit that power, or the core could push
    // the vault key into a harness through `CreateConversationParams.env`.
    const viaExtra = buildHarnessEnv({
      source: {},
      extra: { GENERATORAI_SECRET_KEY: 'vault' },
    });
    const viaDelegated = buildHarnessEnv({
      source: {},
      delegated: { GENERATORAI_SECRET_KEY: 'vault' },
    });

    expect(viaExtra['GENERATORAI_SECRET_KEY']).toBe('vault');
    expect(viaDelegated['GENERATORAI_SECRET_KEY']).toBeUndefined();
  });

  it('lets the provider\'s own `extra` win over a delegated value of the same name', () => {
    const env = buildHarnessEnv({
      source: {},
      delegated: { GENERATORAI_SCRATCH_DIR: '/from-core' },
      extra: { GENERATORAI_SCRATCH_DIR: '/from-provider' },
    });
    expect(env['GENERATORAI_SCRATCH_DIR']).toBe('/from-provider');
  });
});

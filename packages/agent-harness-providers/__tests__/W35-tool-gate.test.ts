// ────────────────────────────────────────────────────────────────
// W35-tool-gate.test.ts
//
// The `PreToolUse` gate was absent on two production paths while the
// capability ledger claimed otherwise.
//
// `capabilities()` returned `fullToolGating: true` unconditionally, on the
// strength of a comment asserting "the PreToolUse hook fires on EVERY tool
// call". But `buildQueryOptions` installed `options.hooks` only when
// `config.hooks` was present, and `buildClaudeHooks` installed
// `hooks['PreToolUse']` only when `bridge.onPreToolUse` existed. Two callers
// supply neither:
//
//   • `apps/server/src/acp-entry.ts` — no hooks, no onPermissionRequest.
//   • `StageExecutionService` — passes `onPermissionRequest` but no `hooks`,
//     so every workflow stage was gated by `canUseTool` alone. Anthropic
//     documents `canUseTool` as "invoked only when the permission evaluation
//     flow resolves to a prompt … To gate every tool call, use a `PreToolUse`
//     hook instead" — i.e. explicitly NOT a security boundary (N-5).
//
// Every test below drives the shipped implementation through
// `buildQueryOptions`, which is the object the SDK is actually handed. None
// of them reimplements the gate: deleting the unconditional install, the
// fail-closed `catch`, the `Promise.race` deadline, or the honest ledger
// turns one of these red.
//
// Companion suite: `truncation-guard.test.ts` covers the bridge-supplied
// branch of the same gate (`buildClaudeHooks`), which is unchanged.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import type { HookBridge } from '@generatorai/core';

type ClaudeHookFn = (input: unknown) => Promise<Record<string, unknown>>;
type HookMap = Record<string, Array<{ hooks: ClaudeHookFn[] }> | undefined>;

/** A conversation config as `buildQueryOptions` expects to find it. */
type StoredConfig = { conversationId: string } & Record<string, unknown>;

function makeProvider(): ClaudeAgentProvider {
  // The constructor spawns nothing — only `initialize()` / `query()` do.
  return new ClaudeAgentProvider({
    cliBinaryPath: '/nonexistent/claude',
    defaultModel: 'sonnet',
    defaultCwd: '/tmp',
  } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
}

/**
 * Register `config` as a live conversation and return the SDK options the
 * provider would build for its next turn. Going through `buildQueryOptions`
 * (rather than `buildClaudeHooks`) is the whole point: the missing gate was
 * not a bug in the translator, it was a missing call to it.
 */
function queryOptionsFor(
  provider: ClaudeAgentProvider,
  config: StoredConfig,
): { hooks?: HookMap } {
  (provider as unknown as { conversations: Map<string, StoredConfig> }).conversations.set(
    config.conversationId,
    config,
  );
  return (provider as unknown as {
    buildQueryOptions(c: StoredConfig): { hooks?: HookMap };
  }).buildQueryOptions(config);
}

/** The single PreToolUse callback the SDK will invoke, or `undefined`. */
function preToolUseOf(options: { hooks?: HookMap }): ClaudeHookFn | undefined {
  return options.hooks?.['PreToolUse']?.[0]?.hooks?.[0];
}

function decisionOf(out: Record<string, unknown>): string | undefined {
  const specific = out['hookSpecificOutput'] as Record<string, unknown> | undefined;
  return specific?.['permissionDecision'] as string | undefined;
}

const HOOK_INPUT = (toolName = 'Bash') => ({
  tool_name: toolName,
  tool_input: { command: 'rm -rf /' },
  cwd: '/tmp',
  session_id: 'sess-1',
});

// ── (a) The gate is installed with no caller opt-in ──

describe('W35 — PreToolUse is installed on EVERY conversation', () => {
  it('installs the gate for a conversation created with NO hooks (the acp-entry shape)', () => {
    // Before the fix: `if (config.hooks)` meant `options.hooks` was never even
    // assigned here, so the SDK ran with no PreToolUse hook at all.
    const options = queryOptionsFor(makeProvider(), { conversationId: 'c-no-hooks' });
    expect(options.hooks).toBeDefined();
    expect(preToolUseOf(options)).toBeInstanceOf(Function);
  });

  it('installs the gate when only `onPermissionRequest` is supplied (the StageExecutionService shape)', () => {
    // This is the exact shape workflow stages create: a canUseTool handler and
    // no hooks. canUseTool is a fall-through prompt, not a gate (N-5).
    const options = queryOptionsFor(makeProvider(), {
      conversationId: 'c-stage',
      onPermissionRequest: async () => ({ granted: true }),
    });
    expect(preToolUseOf(options)).toBeInstanceOf(Function);
  });

  it('still installs the caller\'s own gate when a bridge supplies one', async () => {
    const seen: string[] = [];
    const bridge: HookBridge = {
      onPreToolUse: (input) => {
        seen.push(input.toolName);
        return { decision: 'deny', reason: 'nope' };
      },
    };
    const options = queryOptionsFor(makeProvider(), { conversationId: 'c-bridge', hooks: bridge });
    const hook = preToolUseOf(options)!;
    expect(decisionOf(await hook(HOOK_INPUT('Write')))).toBe('deny');
    expect(seen).toEqual(['Write']);
  });

  it('leaves the other bridge phases untouched', async () => {
    const bridge: HookBridge = { onPostToolUse: () => ({ additionalContext: 'x' }) };
    const options = queryOptionsFor(makeProvider(), { conversationId: 'c-post', hooks: bridge });
    expect(options.hooks?.['PostToolUse']).toBeDefined();
    // …and PreToolUse is added alongside it rather than replacing the map.
    expect(preToolUseOf(options)).toBeInstanceOf(Function);
  });
});

// ── The documented no-policy default ──

describe('W35 — the no-policy default is DEFER, and is documented as such', () => {
  it('returns no decision, so permissionMode / allowedTools / canUseTool still decide', async () => {
    const options = queryOptionsFor(makeProvider(), { conversationId: 'c-defer' });
    const out = await preToolUseOf(options)!(HOOK_INPUT());
    // Neither 'deny' (which would break every existing working path) nor
    // 'allow' (which would short-circuit the SDK's permission evaluation and
    // suppress the canUseTool prompts these paths DO get today).
    expect(decisionOf(out)).toBeUndefined();
  });
});

// ── (b) Fail-closed: error and timeout both deny ──

describe('W35-B2 — the installed gate fails CLOSED', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('DENIES when the provider-level default gate throws', async () => {
    const provider = makeProvider();
    provider.setDefaultToolGate(() => {
      throw new Error('policy backend down');
    });
    const options = queryOptionsFor(provider, { conversationId: 'c-throw' });
    const out = await preToolUseOf(options)!(HOOK_INPUT());
    expect(decisionOf(out)).toBe('deny');
  });

  it('DENIES when the gate never answers (the 5 s deadline expires)', async () => {
    vi.useFakeTimers();
    const provider = makeProvider();
    provider.setDefaultToolGate(() => new Promise(() => { /* never settles */ }));
    const options = queryOptionsFor(provider, { conversationId: 'c-hang' });

    const pending = preToolUseOf(options)!(HOOK_INPUT());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(decisionOf(await pending)).toBe('deny');
  });

  it('DENIES on timeout for a conversation-supplied gate too', async () => {
    vi.useFakeTimers();
    const bridge: HookBridge = { onPreToolUse: () => new Promise(() => { /* never settles */ }) };
    const options = queryOptionsFor(makeProvider(), { conversationId: 'c-hang-2', hooks: bridge });

    const pending = preToolUseOf(options)!(HOOK_INPUT());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(decisionOf(await pending)).toBe('deny');
  });
});

// ── (c) The ledger matches runtime behaviour ──

describe('W35 — preToolUseGated() is honest', () => {
  it('reports FALSE while no policy is attached, matching the hookless runtime', async () => {
    const provider = makeProvider();
    const options = queryOptionsFor(provider, { conversationId: 'c-honest' });

    // Runtime: the hook is installed but expresses no opinion.
    expect(decisionOf(await preToolUseOf(options)!(HOOK_INPUT()))).toBeUndefined();
    // Ledger: says exactly that. It used to hardcode `true` here.
    expect(provider.preToolUseGated()).toBe(false);
    expect(provider.preToolUseGated('c-honest')).toBe(false);
  });

  it('reports TRUE per conversation when that conversation supplies its own gate', async () => {
    const provider = makeProvider();
    const bridge: HookBridge = { onPreToolUse: () => ({ decision: 'deny' }) };
    const options = queryOptionsFor(provider, { conversationId: 'c-gated', hooks: bridge });

    expect(decisionOf(await preToolUseOf(options)!(HOOK_INPUT()))).toBe('deny');
    expect(provider.preToolUseGated('c-gated')).toBe(true);
    // …but the provider-wide floor stays false: the NEXT conversation may
    // supply no bridge, and the floor must not promise on its behalf.
    expect(provider.preToolUseGated()).toBe(false);
  });

  it('reports TRUE provider-wide once a default gate is installed — and then enforces it', async () => {
    const provider = makeProvider();
    expect(provider.preToolUseGated()).toBe(false);

    provider.setDefaultToolGate(() => ({ decision: 'deny', reason: 'default policy' }));

    expect(provider.preToolUseGated()).toBe(true);
    // A conversation with NO hooks of its own is now genuinely gated — this is
    // what makes the `true` honest for acp-entry / StageExecutionService.
    const options = queryOptionsFor(provider, { conversationId: 'c-default-gate' });
    expect(decisionOf(await preToolUseOf(options)!(HOOK_INPUT()))).toBe('deny');
    expect(provider.preToolUseGated('c-default-gate')).toBe(true);
  });

  it('lets a conversation bridge override the provider default', async () => {
    const provider = makeProvider();
    provider.setDefaultToolGate(() => ({ decision: 'deny', reason: 'default policy' }));
    const bridge: HookBridge = { onPreToolUse: () => ({ decision: 'allow', reason: 'chat policy' }) };
    const options = queryOptionsFor(provider, { conversationId: 'c-override', hooks: bridge });
    expect(decisionOf(await preToolUseOf(options)!(HOOK_INPUT()))).toBe('allow');
  });

  it('fails closed on an unknown conversation id', () => {
    const provider = makeProvider();
    expect(provider.preToolUseGated('never-created')).toBe(false);
  });
});

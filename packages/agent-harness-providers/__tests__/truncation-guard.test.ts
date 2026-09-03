// ────────────────────────────────────────────────────────────────
// truncation-guard.test.ts
//
// W13-B1 regression: truncation guard stops incomplete tool calls from executing.
// W35-B2 regression: PreToolUse gate fails CLOSED on error/timeout.
// W34-M3 regression: ProviderInstanceId prefix routing works end-to-end.
//
// ⚠ This file previously imported nothing but `vitest` and asserted against
// re-implementations of all three mechanisms pasted into the test file. That
// made it worthless as regression evidence: deleting the real fail-closed
// `Promise.race` from `ClaudeAgentProvider`, or the real truncation predicate,
// left every test here green. The copies had already drifted — the routing
// copy hardcoded a two-entry `ALL_HARNESS_TYPES`, so it asserted that
// `codex:default` routes NOWHERE while production routes it to `codex`.
//
// Every test below now drives the shipped implementation:
//   • `isTruncationStopReason`   — the real predicate from ClaudeAgentProvider.
//   • `isTruncationFinishReason` — the real predicate from CopilotProvider.
//   • `buildClaudeHooks`         — the real PreToolUse hook the SDK is handed.
//   • `MultiHarness.resolveTarget` — the real router, over the real
//                                    `ALL_HARNESS_TYPES` from HarnessRegistry.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isTruncationStopReason, ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import { isTruncationFinishReason } from '../src/providers/copilot/CopilotProvider.js';
import { MultiHarness } from '../src/MultiHarness.js';
import { HarnessRegistry, ALL_HARNESS_TYPES } from '../src/HarnessRegistry.js';
import type { HarnessType } from '../src/types.js';
import type { CreateConversationParams } from '@generatorai/core';
import type { HookBridge, PreToolUseHookOutput } from '@generatorai/core';

// ── W13-B1: isTruncationStopReason (the REAL ClaudeAgentProvider predicate) ──

describe('W13-B1 — isTruncationStopReason (ClaudeAgentProvider)', () => {
  it('recognises max_tokens (Anthropic canonical)', () => {
    expect(isTruncationStopReason('max_tokens')).toBe(true);
  });

  it('recognises length (OpenAI / Codex canonical)', () => {
    expect(isTruncationStopReason('length')).toBe(true);
  });

  it('recognises partial max_token* values (provider variations)', () => {
    expect(isTruncationStopReason('max_token_limit')).toBe(true);
    expect(isTruncationStopReason('max_tokens_reached')).toBe(true);
  });

  it('recognises context_length* values', () => {
    expect(isTruncationStopReason('context_length_exceeded')).toBe(true);
    expect(isTruncationStopReason('context_length')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isTruncationStopReason('MAX_TOKENS')).toBe(true);
    expect(isTruncationStopReason('Length')).toBe(true);
  });

  it('does NOT flag normal stop reasons', () => {
    expect(isTruncationStopReason('end_turn')).toBe(false);
    expect(isTruncationStopReason('stop_sequence')).toBe(false);
    expect(isTruncationStopReason('tool_use')).toBe(false);
    expect(isTruncationStopReason('cancelled')).toBe(false);
    expect(isTruncationStopReason('')).toBe(false);
  });
});

// ── W13-B1: isTruncationFinishReason (the REAL CopilotProvider predicate) ──

describe('W13-B1 — isTruncationFinishReason (CopilotProvider)', () => {
  it('recognises token_limit (Copilot SDK)', () => {
    expect(isTruncationFinishReason('token_limit')).toBe(true);
  });

  it('recognises the shared truncation vocabulary', () => {
    expect(isTruncationFinishReason('max_tokens')).toBe(true);
    expect(isTruncationFinishReason('length')).toBe(true);
    expect(isTruncationFinishReason('context_length_exceeded')).toBe(true);
  });

  it('returns false for non-string inputs', () => {
    expect(isTruncationFinishReason(null)).toBe(false);
    expect(isTruncationFinishReason(undefined)).toBe(false);
    expect(isTruncationFinishReason(42)).toBe(false);
    expect(isTruncationFinishReason({})).toBe(false);
  });

  it('does NOT flag normal finish reasons', () => {
    expect(isTruncationFinishReason('stop')).toBe(false);
    expect(isTruncationFinishReason('end_turn')).toBe(false);
  });
});

// ── W34-M3: ProviderInstanceId prefix routing (the REAL MultiHarness router) ──

/**
 * A registry that never spawns anything. `resolveTarget` only reads
 * `registry.primary` and `registry.resolveProviderForModel`, so a registry
 * built over a `buildConfig` that throws is enough — and proves the routing
 * decision is made from the id alone, without touching a provider.
 */
function makeRouter(): { multi: MultiHarness; resolve: (params: CreateConversationParams) => Promise<HarnessType> } {
  const registry = new HarnessRegistry({
    buildConfig: () => { throw new Error('buildConfig must not be called during routing'); },
    primary: 'copilot',
  });
  const multi = new MultiHarness(registry);
  return {
    multi,
    // `resolveTarget` is private by design — routing is not a public surface.
    // Reaching it by index access is deliberate: the alternative (going through
    // `createConversation`) would require a live adapter per provider type and
    // would test the adapter, not the router.
    resolve: (params) =>
      (multi as unknown as { resolveTarget(p: CreateConversationParams): Promise<HarnessType> }).resolveTarget(params),
  };
}

describe('W34-M3 — ProviderInstanceId prefix routing (MultiHarness.resolveTarget)', () => {
  it('routes every driver type in ALL_HARNESS_TYPES, not just the managed two', async () => {
    const { resolve } = makeRouter();
    // The pasted copy this test replaced hardcoded ['copilot', 'claude-agent'],
    // so it asserted codex/opencode/acp route NOWHERE. Drive the real list.
    expect(ALL_HARNESS_TYPES.length).toBe(5);
    for (const type of ALL_HARNESS_TYPES) {
      await expect(resolve({ conversationId: 'c', providerInstanceId: `${type}:default` } as CreateConversationParams))
        .resolves.toBe(type);
    }
  });

  it('resolves a uuid-shaped suffix', async () => {
    const { resolve } = makeRouter();
    await expect(
      resolve({
        conversationId: 'c',
        providerInstanceId: 'claude-agent:550e8400-e29b-41d4-a716-446655440000',
      } as CreateConversationParams),
    ).resolves.toBe('claude-agent');
  });

  it('prefers an explicit instanceTypeMap entry over the prefix parse', async () => {
    const { multi, resolve } = makeRouter();
    // A registered instance may deliberately be named with a foreign prefix;
    // the map is authoritative (L17), the prefix parse is only the fallback.
    multi.setInstanceTypeMap(new Map([['copilot:work', 'claude-agent' as HarnessType]]));
    await expect(resolve({ conversationId: 'c', providerInstanceId: 'copilot:work' } as CreateConversationParams))
      .resolves.toBe('claude-agent');
  });

  it('falls back to the primary provider for an unknown driver prefix', async () => {
    const { resolve } = makeRouter();
    for (const id of ['openai:default', 'gemini:default', 'claude-agent', '', ':suffix']) {
      await expect(resolve({ conversationId: 'c', providerInstanceId: id } as CreateConversationParams))
        .resolves.toBe('copilot'); // registry.primary
    }
  });

  it('honours an explicit harnessType when no providerInstanceId is supplied', async () => {
    const { resolve } = makeRouter();
    await expect(resolve({ conversationId: 'c', harnessType: 'codex' } as CreateConversationParams))
      .resolves.toBe('codex');
  });
});

// ── W35-B2: PreToolUse fail-closed behaviour (the REAL Claude SDK hook) ──

type ClaudeHookFn = (input: unknown) => Promise<Record<string, unknown>>;

/**
 * Pull the single PreToolUse hook function out of the object
 * `buildClaudeHooks` hands to the Claude Agent SDK, so the test invokes
 * EXACTLY what the SDK invokes. If the `Promise.race` deadline or the
 * fail-closed `catch` is removed from the provider, these tests go red.
 */
function preToolUseHook(onPreToolUse: HookBridge['onPreToolUse']): ClaudeHookFn {
  // The constructor does not spawn anything — only `initialize()` does.
  const provider = new ClaudeAgentProvider({
    cliBinaryPath: '/nonexistent/claude',
    defaultModel: 'sonnet',
    defaultCwd: '/tmp',
  } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
  const hooks = (provider as unknown as {
    buildClaudeHooks(bridge: HookBridge): Record<string, Array<{ hooks: ClaudeHookFn[] }>>;
  }).buildClaudeHooks({ onPreToolUse });
  const fn = hooks['PreToolUse']?.[0]?.hooks?.[0];
  if (!fn) throw new Error('buildClaudeHooks did not register a PreToolUse hook');
  return fn;
}

function decisionOf(out: Record<string, unknown>): string | undefined {
  const specific = out['hookSpecificOutput'] as Record<string, unknown> | undefined;
  return specific?.['permissionDecision'] as string | undefined;
}

const HOOK_INPUT = (toolName: string) => ({
  tool_name: toolName,
  tool_input: { file_path: '/tmp/x' },
  cwd: '/tmp',
  session_id: 'sess-1',
});

describe('W35-B2 — PreToolUse fail-closed semantics (ClaudeAgentProvider.buildClaudeHooks)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers no PreToolUse hook when the bridge supplies no gate', () => {
    const provider = new ClaudeAgentProvider({
      cliBinaryPath: '/nonexistent/claude',
    } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
    const hooks = (provider as unknown as {
      buildClaudeHooks(bridge: HookBridge): Record<string, unknown>;
    }).buildClaudeHooks({});
    expect(hooks['PreToolUse']).toBeUndefined();
  });

  it('does not deny when the gate returns undefined', async () => {
    const hook = preToolUseHook(async () => undefined);
    const out = await hook(HOOK_INPUT('Read'));
    expect(decisionOf(out)).toBeUndefined();
  });

  it('passes an allow decision through unchanged', async () => {
    const hook = preToolUseHook(async (): Promise<PreToolUseHookOutput> => ({ decision: 'allow' }));
    expect(decisionOf(await hook(HOOK_INPUT('Read')))).toBe('allow');
  });

  it('passes a deny decision (and its reason) through unchanged', async () => {
    const hook = preToolUseHook(async (): Promise<PreToolUseHookOutput> => ({ decision: 'deny', reason: 'policy' }));
    const out = await hook(HOOK_INPUT('Write'));
    expect(decisionOf(out)).toBe('deny');
    expect((out['hookSpecificOutput'] as Record<string, unknown>)['permissionDecisionReason']).toBe('policy');
  });

  it('forwards the real tool name and args to the gate', async () => {
    const seen: Array<{ toolName: string; toolArgs: unknown; sessionId: string }> = [];
    const hook = preToolUseHook(async (input, invocation) => {
      seen.push({ toolName: input.toolName, toolArgs: input.toolArgs, sessionId: invocation.sessionId });
      return { decision: 'allow' };
    });
    await hook(HOOK_INPUT('Bash'));
    expect(seen).toEqual([{ toolName: 'Bash', toolArgs: { file_path: '/tmp/x' }, sessionId: 'sess-1' }]);
  });

  it('DENIES when the gate throws synchronously (fail-closed — B2)', async () => {
    const hook = preToolUseHook(() => { throw new Error('Permission service unavailable'); });
    const out = await hook(HOOK_INPUT('Bash'));
    expect(decisionOf(out)).toBe('deny');
    expect(String((out['hookSpecificOutput'] as Record<string, unknown>)['permissionDecisionReason']))
      .toContain('Permission service unavailable');
  });

  it('DENIES on async rejection inside the gate (fail-closed — B2)', async () => {
    const hook = preToolUseHook(async () => {
      await Promise.resolve();
      throw new Error('Async gate error');
    });
    expect(decisionOf(await hook(HOOK_INPUT('Edit')))).toBe('deny');
  });

  it('DENIES when the gate never settles, after the 5s deadline (fail-closed — B2)', async () => {
    vi.useFakeTimers();
    const hook = preToolUseHook(() => new Promise<never>(() => { /* never settles */ }));
    const pending = hook(HOOK_INPUT('Write'));
    // Nothing has been decided yet — the gate is genuinely awaited, not
    // short-circuited. Then the provider's own deadline must fire.
    await vi.advanceTimersByTimeAsync(4_999);
    await vi.advanceTimersByTimeAsync(2);
    const out = await pending;
    expect(decisionOf(out)).toBe('deny');
    expect(String((out['hookSpecificOutput'] as Record<string, unknown>)['permissionDecisionReason']))
      .toMatch(/timeout/i);
  });

  it('does NOT time out a gate that answers just under the deadline', async () => {
    vi.useFakeTimers();
    const hook = preToolUseHook(
      () => new Promise<PreToolUseHookOutput>((resolve) => setTimeout(() => resolve({ decision: 'allow' }), 4_000)),
    );
    const pending = hook(HOOK_INPUT('Read'));
    await vi.advanceTimersByTimeAsync(4_001);
    expect(decisionOf(await pending)).toBe('allow');
  });
});

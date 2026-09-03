import { describe, it, expect, vi } from 'vitest';

import { MultiHarness } from '../MultiHarness.js';
import type { HarnessRegistry } from '../HarnessRegistry.js';
import type { HarnessType } from '../types.js';
import type { CreateConversationParams } from '@generatorai/core';

/**
 * Regression coverage for a live BLOCKER found during runtime verification:
 * a chat bound to `claude-agent` was silently rebound to `copilot` on its
 * first prompt, which destroyed the Claude session and took the server down.
 *
 * The observed sequence, from a real server log:
 *
 *   [MultiHarness] conversation chat-63a4… → 'claude-agent' (model=default)
 *   [ChatRoutes]   Prompt submitted for chat 63a4…
 *   [MultiHarness] conversation chat-63a4… moving 'claude-agent' → 'copilot' (model=auto)
 *   [Server]       EVENT LOOP WEDGE DETECTED — main loop has not ticked for ~5431ms
 *   CopilotClient.createSession → Cannot read properties of null (reading 'sendRequest')
 *   [Server]       fatal:wedge-detected received; graceful shutdown initiated
 *
 * Two independent causes, both covered here:
 *
 *  1. `'auto'` is a provider-agnostic SENTINEL meaning "you pick the model",
 *     but each vendor spells it differently — Copilot publishes `auto` in its
 *     catalog, claude-agent publishes `default`. Resolving a sentinel through
 *     the shared model catalog therefore answers "who spells it this way",
 *     which is not a routing question. Since the web composer's default model
 *     is `'auto'`, EVERY claude-agent chat resolved to Copilot.
 *
 *  2. Even for a real model, a catalog inference must not be allowed to move
 *     an ESTABLISHED conversation. Moving is destructive — `resumeConversation`
 *     destroys the provider-side session and starts a fresh one, discarding the
 *     agent context — so it requires an explicit `harnessType` /
 *     `providerInstanceId`, never a guess from a stored string.
 *
 * These tests fail against the pre-fix `resolveTarget`, which consulted only
 * `params.model` and never the conversation's existing owner.
 */

interface FakeAdapter {
  createConversation: ReturnType<typeof vi.fn>;
  resumeConversation: ReturnType<typeof vi.fn>;
  destroyConversation: ReturnType<typeof vi.fn>;
}

function makeAdapter(): FakeAdapter {
  return {
    createConversation: vi.fn(async (p: CreateConversationParams) => p.conversationId ?? 'generated-id'),
    resumeConversation: vi.fn(async () => undefined),
    destroyConversation: vi.fn(async () => undefined),
  };
}

/**
 * A registry whose catalog mirrors the real one observed at runtime:
 * Copilot lists `auto` (plus real models); claude-agent lists `default`
 * (plus its own). The two vendors share no model id.
 */
function makeRegistry(primary: HarnessType = 'claude-agent') {
  const catalog: Record<string, HarnessType> = {
    auto: 'copilot',
    'gpt-5.5': 'copilot',
    'claude-sonnet-5': 'copilot',
    default: 'claude-agent',
    sonnet: 'claude-agent',
    opus: 'claude-agent',
  };

  const adapters: Partial<Record<HarnessType, FakeAdapter>> = {
    copilot: makeAdapter(),
    'claude-agent': makeAdapter(),
  };

  const resolveProviderForModel = vi.fn(async (id: string) => catalog[id] ?? null);

  // Mirrors the live catalogs: the two vendors share no model id, and each
  // spells "you choose" differently — `auto` for Copilot, `default` for
  // claude-agent.
  const statusSnapshot = {
    copilot: { models: [{ id: 'auto' }, { id: 'gpt-5.5' }, { id: 'claude-sonnet-5' }] },
    'claude-agent': { models: [{ id: 'default' }, { id: 'sonnet' }, { id: 'opus' }] },
  };

  const registry = {
    primary,
    readyTypes: ['copilot', 'claude-agent'] as HarnessType[],
    statusSnapshot,
    resolveProviderForModel,
    hasInstance: () => false,
    peek: (t: HarnessType) => adapters[t] ?? null,
    get: vi.fn(async (t: HarnessType) => adapters[t]),
  } as unknown as HarnessRegistry;

  return { registry, adapters, resolveProviderForModel };
}

/**
 * The model handed to an adapter on its last `createConversation`.
 *
 * Deliberately NOT "the last call across create-or-resume": an earlier version
 * of this helper did that and made the foreign-model test pass vacuously — it
 * kept reading the setup `createConversation` (which carries no model) instead
 * of the `resumeConversation` under test, so it was green against the pre-fix
 * code. The two paths are asserted separately for exactly that reason.
 */
function modelOnCreate(adapter: FakeAdapter): unknown {
  const params = adapter.createConversation.mock.calls.at(-1)?.[0] as { model?: unknown } | undefined;
  return params && 'model' in params ? params.model : undefined;
}

/** The model handed to an adapter on its last `resumeConversation(id, params)`. */
function modelOnResume(adapter: FakeAdapter): unknown {
  const params = adapter.resumeConversation.mock.calls.at(-1)?.[1] as { model?: unknown } | undefined;
  return params && 'model' in params ? params.model : undefined;
}

describe('MultiHarness — an established binding survives a model-name inference', () => {
  it("does not move a claude-agent chat to copilot because the model is the sentinel 'auto'", async () => {
    const { registry, adapters } = makeRegistry();
    const harness = new MultiHarness(registry);

    // The chat is created on claude-agent, exactly as the server log shows.
    await harness.createConversation({
      conversationId: 'chat-1',
      harnessType: 'claude-agent',
    } as CreateConversationParams);
    expect(harness.ownerOf('chat-1')).toBe('claude-agent');

    // First prompt. `buildConversationConfig` replays the chat's stored model,
    // which for a web-created chat is the composer default 'auto', and carries
    // NO harnessType (the chat model picker never sets one).
    await harness.resumeConversation('chat-1', {
      conversationId: 'chat-1',
      model: 'auto',
    } as CreateConversationParams);

    // Pre-fix this was 'copilot'.
    expect(harness.ownerOf('chat-1')).toBe('claude-agent');
    // The Claude session must NOT have been torn down.
    expect(adapters['claude-agent']!.destroyConversation).not.toHaveBeenCalled();
    // Copilot must never have been engaged at all — this is the call that
    // threw on a null client and wedged the event loop in production.
    expect(adapters.copilot!.createConversation).not.toHaveBeenCalled();
  });

  it('keeps the binding even when the model belongs to another provider, absent an explicit harnessType', async () => {
    const { registry, adapters } = makeRegistry();
    const harness = new MultiHarness(registry);

    await harness.createConversation({
      conversationId: 'chat-2',
      harnessType: 'claude-agent',
    } as CreateConversationParams);

    // A real Copilot-only model id arriving with no explicit harness. This is
    // a stale/replayed value, not a user action, so it must not tear down the
    // live Claude session.
    await harness.resumeConversation('chat-2', {
      conversationId: 'chat-2',
      model: 'gpt-5.5',
    } as CreateConversationParams);

    expect(harness.ownerOf('chat-2')).toBe('claude-agent');
    expect(adapters.copilot!.createConversation).not.toHaveBeenCalled();
  });

  it('still honours an EXPLICIT harnessType, so a deliberate provider switch keeps working', async () => {
    const { registry, adapters } = makeRegistry();
    const harness = new MultiHarness(registry);

    await harness.createConversation({
      conversationId: 'chat-3',
      harnessType: 'claude-agent',
    } as CreateConversationParams);

    // The user genuinely asks for Copilot. This SHOULD move, and should retire
    // the old provider's session on the way.
    await harness.resumeConversation('chat-3', {
      conversationId: 'chat-3',
      harnessType: 'copilot',
      model: 'gpt-5.5',
    } as CreateConversationParams);

    expect(harness.ownerOf('chat-3')).toBe('copilot');
    expect(adapters['claude-agent']!.destroyConversation).toHaveBeenCalledWith('chat-3');
    expect(adapters.copilot!.createConversation).toHaveBeenCalled();
  });

  it('still routes a NEW conversation by model, where there is no binding to protect', async () => {
    const { registry } = makeRegistry();
    const harness = new MultiHarness(registry);

    // No prior owner: model-driven routing is the only signal, and must work.
    await harness.createConversation({
      conversationId: 'chat-4',
      model: 'gpt-5.5',
    } as CreateConversationParams);

    expect(harness.ownerOf('chat-4')).toBe('copilot');
  });

  it("routes a NEW conversation carrying only the sentinel 'auto' to the configured primary, not to Copilot", async () => {
    // The headline case for a self-hosted user who has set HARNESS_TYPE=claude-agent:
    // a brand-new chat from the web composer carries model 'auto' and no harness.
    // It must land on their configured primary.
    const { registry } = makeRegistry('claude-agent');
    const harness = new MultiHarness(registry);

    await harness.createConversation({
      conversationId: 'chat-5',
      model: 'auto',
    } as CreateConversationParams);

    expect(harness.ownerOf('chat-5')).toBe('claude-agent');
  });

  it('does not consult the model catalog at all for a sentinel', async () => {
    const { registry, resolveProviderForModel } = makeRegistry();
    const harness = new MultiHarness(registry);

    await harness.createConversation({
      conversationId: 'chat-6',
      model: 'default',
    } as CreateConversationParams);

    // A sentinel carries no routing information, so the lookup is pointless
    // work — and, during the registry's 22-second background refresh, actively
    // misleading: only providers already marked `ready` are considered, so a
    // slow-to-report provider loses every race it should have won.
    expect(resolveProviderForModel).not.toHaveBeenCalled();
  });

  it('protects the binding on the RECOVERY path too (ensureConversation re-creates by id)', async () => {
    const { registry, adapters } = makeRegistry();
    const harness = new MultiHarness(registry);

    await harness.createConversation({
      conversationId: 'chat-7',
      harnessType: 'claude-agent',
    } as CreateConversationParams);

    // `ChatManagementService.ensureConversation` rebuilds a lost session by
    // calling createConversation again with the SAME id — the path that
    // produced the null-client crash in the log above.
    await harness.createConversation({
      conversationId: 'chat-7',
      model: 'auto',
    } as CreateConversationParams);

    expect(harness.ownerOf('chat-7')).toBe('claude-agent');
    expect(adapters.copilot!.createConversation).not.toHaveBeenCalled();
  });
});

/**
 * The second half of the sentinel problem, found by a live read-along run
 * after the routing half was fixed.
 *
 * Routing correctly refused to move a claude-agent chat because its model was
 * `'auto'` — and then handed claude-agent the literal string `'auto'` anyway.
 * The provider rejected it:
 *
 *   [ClaudeAgentAdapter] Background query failed for chat-bddd6514-…:
 *   Claude Code returned an error result: There's an issue with the selected
 *   model (auto). It may not exist or you may not have access to it.
 *
 * Zero `harness.token` events, no answer — the SAME "no output at all" symptom
 * as the routing bug, one layer further down.
 *
 * The same hole is reachable without a sentinel: because an established
 * binding now outranks a model inference, a claude-agent chat carrying a stale
 * Copilot-only id keeps its binding and would be handed that foreign id.
 */
describe('MultiHarness — a provider is never handed a model it does not offer', () => {
  it("does not pass the sentinel 'auto' through to claude-agent", async () => {
    const { registry, adapters } = makeRegistry();
    const harness = new MultiHarness(registry);

    await harness.createConversation({
      conversationId: 'chat-a',
      harnessType: 'claude-agent',
      model: 'auto',
    } as CreateConversationParams);

    // Omitted entirely, so the provider picks its own default — the same path
    // a brand-new chat with no model already takes.
    expect(modelOnCreate(adapters['claude-agent']!)).toBeUndefined();
  });

  it('does not pass a foreign REAL model to the provider that kept the binding', async () => {
    const { registry, adapters } = makeRegistry();
    const harness = new MultiHarness(registry);

    await harness.createConversation({
      conversationId: 'chat-b',
      harnessType: 'claude-agent',
    } as CreateConversationParams);

    await harness.resumeConversation('chat-b', {
      conversationId: 'chat-b',
      model: 'gpt-5.5', // Copilot-only, and the binding is staying put
    } as CreateConversationParams);

    expect(harness.ownerOf('chat-b')).toBe('claude-agent');
    expect(modelOnResume(adapters['claude-agent']!)).toBeUndefined();
  });

  it("still passes 'auto' to Copilot, where it is a REAL catalog model", async () => {
    const { registry, adapters } = makeRegistry('copilot');
    const harness = new MultiHarness(registry);

    await harness.createConversation({
      conversationId: 'chat-c',
      harnessType: 'copilot',
      model: 'auto',
    } as CreateConversationParams);

    // Copilot publishes `auto`; stripping it here would throw away a real
    // user choice.
    expect(modelOnCreate(adapters.copilot!)).toBe('auto');
  });

  it('passes a model the target genuinely offers, untouched', async () => {
    const { registry, adapters } = makeRegistry();
    const harness = new MultiHarness(registry);

    await harness.createConversation({
      conversationId: 'chat-d',
      harnessType: 'claude-agent',
      model: 'sonnet',
    } as CreateConversationParams);

    expect(modelOnCreate(adapters['claude-agent']!)).toBe('sonnet');
  });

  it('leaves the model alone when the target catalog is unknown', async () => {
    const { registry, adapters } = makeRegistry();
    // An unprobed provider reports an empty catalog. Treating that as "offers
    // nothing" would strip every legitimate model during the boot window.
    (registry as unknown as { statusSnapshot: Record<string, unknown> }).statusSnapshot = {
      'claude-agent': { models: [] },
    };
    const harness = new MultiHarness(registry);

    await harness.createConversation({
      conversationId: 'chat-e',
      harnessType: 'claude-agent',
      model: 'sonnet',
    } as CreateConversationParams);

    expect(modelOnCreate(adapters['claude-agent']!)).toBe('sonnet');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { HarnessProxy } from '../src/HarnessProxy.js';
import { MultiHarness } from '../src/MultiHarness.js';
import type { HarnessRegistry } from '../src/HarnessRegistry.js';
import type { IAgentHarness, SendPromptOptions } from '@generatorai/core';

/**
 * PLN-01 regression guard.
 *
 * `sendPrompt`'s new per-turn options bag is an OPTIONAL trailing parameter, so
 * TypeScript happily accepts a forwarder that declares fewer parameters and
 * silently drops it. A green build therefore proves nothing — these tests
 * assert the value actually arrives at the leaf adapter through both the proxy
 * and the multi-provider router.
 */

function makeLeaf(): { adapter: IAgentHarness; sendPrompt: ReturnType<typeof vi.fn>; sendPromptAndWait: ReturnType<typeof vi.fn> } {
  const sendPrompt = vi.fn().mockResolvedValue(undefined);
  const sendPromptAndWait = vi.fn().mockResolvedValue({ content: 'ok' });
  const adapter = {
    initialize: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    forceStop: vi.fn().mockResolvedValue(undefined),
    getClientState: vi.fn().mockReturnValue('running'),
    ping: vi.fn().mockResolvedValue(true),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getModels: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn().mockResolvedValue('c1'),
    resumeConversation: vi.fn().mockResolvedValue(undefined),
    hasLiveConversation: vi.fn().mockReturnValue(true),
    listConversations: vi.fn().mockResolvedValue([]),
    getLastConversationId: vi.fn().mockResolvedValue(null),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    destroyConversation: vi.fn().mockResolvedValue(undefined),
    sendPrompt,
    sendPromptAndWait,
    getMessages: vi.fn().mockResolvedValue([]),
    abortConversation: vi.fn().mockResolvedValue(undefined),
    onConversationEvent: vi.fn().mockReturnValue(() => {}),
    onClientEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as IAgentHarness;
  return { adapter, sendPrompt, sendPromptAndWait };
}

const PLAN: SendPromptOptions = { agentMode: 'plan' };

describe('HarnessProxy forwards per-turn options (PLN-01)', () => {
  it('sendPrompt passes options through to the adapter', async () => {
    const leaf = makeLeaf();
    const proxy = new HarnessProxy(leaf.adapter, 'copilot');

    await proxy.sendPrompt('c1', 'hello', undefined, PLAN);

    expect(leaf.sendPrompt).toHaveBeenCalledWith('c1', 'hello', undefined, PLAN);
  });

  it('sendPromptAndWait passes options through to the adapter', async () => {
    const leaf = makeLeaf();
    const proxy = new HarnessProxy(leaf.adapter, 'copilot');

    await proxy.sendPromptAndWait('c1', 'hello', undefined, undefined, PLAN);

    expect(leaf.sendPromptAndWait).toHaveBeenCalledWith('c1', 'hello', undefined, undefined, PLAN);
  });

  it('omitting options forwards undefined (legacy callers unaffected)', async () => {
    const leaf = makeLeaf();
    const proxy = new HarnessProxy(leaf.adapter, 'copilot');

    await proxy.sendPrompt('c1', 'hello');

    expect(leaf.sendPrompt).toHaveBeenCalledWith('c1', 'hello', undefined, undefined);
  });
});

describe('MultiHarness forwards per-turn options (PLN-01)', () => {
  function makeRouter(leaf: IAgentHarness) {
    const registry = {
      get: vi.fn().mockResolvedValue(leaf),
      primaryType: 'copilot',
      resolveProviderForModel: vi.fn().mockResolvedValue('copilot'),
    } as unknown as HarnessRegistry;
    return new MultiHarness(registry);
  }

  it('sendPrompt reaches the routed adapter with options intact', async () => {
    const leaf = makeLeaf();
    const router = makeRouter(leaf.adapter);
    await router.createConversation({ conversationId: 'c1' });

    await router.sendPrompt('c1', 'hello', undefined, PLAN);

    expect(leaf.sendPrompt).toHaveBeenCalledWith('c1', 'hello', undefined, PLAN);
  });

  it('sendPromptAndWait reaches the routed adapter with options intact', async () => {
    const leaf = makeLeaf();
    const router = makeRouter(leaf.adapter);
    await router.createConversation({ conversationId: 'c1' });

    await router.sendPromptAndWait('c1', 'hello', undefined, undefined, PLAN);

    expect(leaf.sendPromptAndWait).toHaveBeenCalledWith('c1', 'hello', undefined, undefined, PLAN);
  });

  it('full chain MultiHarness → HarnessProxy → adapter preserves agentMode', async () => {
    const leaf = makeLeaf();
    const proxy = new HarnessProxy(leaf.adapter, 'copilot');
    const router = makeRouter(proxy);
    await router.createConversation({ conversationId: 'c1' });

    await router.sendPrompt('c1', 'hello', undefined, PLAN);

    expect(leaf.sendPrompt).toHaveBeenCalledWith('c1', 'hello', undefined, PLAN);
  });
});

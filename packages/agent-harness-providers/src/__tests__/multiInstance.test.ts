// ────────────────────────────────────────────────────────────────
// W34 — multi-instance provider registry, wired end-to-end.
//
// `ProviderInstanceRegistry` existed but was never instantiated, and
// `HarnessRegistry`/`MultiHarness` held exactly one adapter per driver TYPE
// ('copilot', 'acp', …) — so two accounts of the same driver could not run
// concurrently no matter what routing hints a caller supplied. This test
// proves the fix genuinely closes that gap: it spawns TWO REAL, independent
// ACP agent processes (same driver type, `acp`) under two different
// `ProviderInstanceId`s, routes two conversations to them through the real
// `MultiHarness` + `ProviderInstanceRegistry` + `HarnessRegistry` stack (no
// mocks), and asserts they never cross-talk.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { HarnessRegistry } from '../HarnessRegistry.js';
import { MultiHarness } from '../MultiHarness.js';
import { ProviderInstanceRegistry } from '../ProviderInstanceRegistry.js';
import { makeProviderInstanceId } from '@generatorai/core';
import type { CreateConversationParams } from '@generatorai/core';

const FIXTURE_AGENT = join(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  'providers',
  'acp',
  '__tests__',
  'fixtures',
  'fakeAcpAgent.mjs',
);

function makeRegistry(): HarnessRegistry {
  return new HarnessRegistry({
    // Never actually invoked in this test — every conversation is routed
    // through a registered INSTANCE, not the default type-level path.
    buildConfig: () => ({ type: 'acp', acp: { command: 'unused' } }),
    primary: 'acp',
  });
}

describe('W34 — multi-instance routing (real processes, no mocks)', () => {
  const registries: HarnessRegistry[] = [];

  afterEach(async () => {
    await Promise.all(registries.splice(0).map((r) => r.shutdownAll()));
  });

  it('getInstance() returns a DISTINCT adapter per instance id, even for the same driver type', async () => {
    const registry = makeRegistry();
    registries.push(registry);
    registry.registerInstance(makeProviderInstanceId('acp:work'), 'acp', {
      type: 'acp',
      acp: { command: process.execPath, args: [FIXTURE_AGENT] },
    });
    registry.registerInstance(makeProviderInstanceId('acp:personal'), 'acp', {
      type: 'acp',
      acp: { command: process.execPath, args: [FIXTURE_AGENT] },
    });

    const [work, personal] = await Promise.all([
      registry.getInstance(makeProviderInstanceId('acp:work')),
      registry.getInstance(makeProviderInstanceId('acp:personal')),
    ]);

    expect(work).not.toBe(personal);
    expect(registry.peekInstance(makeProviderInstanceId('acp:work'))).toBe(work);
    expect(registry.peekInstance(makeProviderInstanceId('acp:personal'))).toBe(personal);

    // Concurrent callers for the SAME instance must share one in-flight init
    // (mirrors the existing get()/type-level guarantee) — not spawn two CLIs.
    const [again, alsoAgain] = await Promise.all([
      registry.getInstance(makeProviderInstanceId('acp:work')),
      registry.getInstance(makeProviderInstanceId('acp:work')),
    ]);
    expect(again).toBe(work);
    expect(alsoAgain).toBe(work);
  }, 15_000);

  it('two conversations pinned to two accounts of the SAME driver never cross-talk', async () => {
    const registry = makeRegistry();
    registries.push(registry);
    const workId = makeProviderInstanceId('acp:work');
    const personalId = makeProviderInstanceId('acp:personal');
    registry.registerInstance(workId, 'acp', {
      type: 'acp',
      acp: { command: process.execPath, args: [FIXTURE_AGENT] },
    });
    registry.registerInstance(personalId, 'acp', {
      type: 'acp',
      acp: { command: process.execPath, args: [FIXTURE_AGENT] },
    });

    const instanceRegistry = new ProviderInstanceRegistry();
    instanceRegistry.register({
      id: workId,
      driverType: 'acp',
      protocol: 'acp',
      displayName: 'ACP (work)',
      capabilities: {
        vision: false, reasoning: false, reasoningEfforts: [], planMode: false,
        mcpServers: false, skillDirectories: false, fullToolGating: false,
        sessionPersistence: false, budgetTracking: false,
      },
      enabled: true,
    });
    instanceRegistry.register({
      id: personalId,
      driverType: 'acp',
      protocol: 'acp',
      displayName: 'ACP (personal)',
      capabilities: {
        vision: false, reasoning: false, reasoningEfforts: [], planMode: false,
        mcpServers: false, skillDirectories: false, fullToolGating: false,
        sessionPersistence: false, budgetTracking: false,
      },
      enabled: true,
    });

    const multiHarness = new MultiHarness(registry, undefined, undefined, instanceRegistry);

    const idA = await multiHarness.createConversation({
      conversationId: 'conv-work',
      providerInstanceId: workId,
    } as CreateConversationParams);
    const idB = await multiHarness.createConversation({
      conversationId: 'conv-personal',
      providerInstanceId: personalId,
    } as CreateConversationParams);

    // The instance registry is now the source of truth for routing — confirm
    // it actually recorded each conversation against the RIGHT instance, not
    // just "some acp instance".
    expect(instanceRegistry.resolveForConversation(idA)?.id).toBe(workId);
    expect(instanceRegistry.resolveForConversation(idB)?.id).toBe(personalId);

    const [responseA, responseB] = await Promise.all([
      multiHarness.sendPromptAndWait(idA, 'hello from work TOOL:read'),
      multiHarness.sendPromptAndWait(idB, 'hello from personal'),
    ]);

    expect(responseA.content).toContain('Hello from fake agent.');
    expect(responseB.content).toContain('Hello from fake agent.');

    // The two conversations must resolve to two DIFFERENT live processes —
    // the actual claim of W34, not just "two conversation ids exist".
    const adapterA = await registry.getInstance(workId);
    const adapterB = await registry.getInstance(personalId);
    expect(adapterA).not.toBe(adapterB);
    expect(adapterA.hasLiveConversation(idA)).toBe(true);
    expect(adapterA.hasLiveConversation(idB)).toBe(false);
    expect(adapterB.hasLiveConversation(idB)).toBe(true);
    expect(adapterB.hasLiveConversation(idA)).toBe(false);
  }, 15_000);

  it('falls back to type-level routing unchanged when no instance registry is wired', async () => {
    const registry = makeRegistry();
    registries.push(registry);
    // No registerInstance() call at all, no instanceRegistry passed — this
    // must behave exactly as MultiHarness did before W34.
    const multiHarness = new MultiHarness(registry);
    // resolveTarget() falls through to `registry.primary` ('acp' here), which
    // tries the never-registered default 'acp' type adapter via buildConfig()
    // (command: 'unused') and fails — proving the OLD path is untouched and
    // still requires the type-level config to be real, rather than silently
    // succeeding through the new instance path it has no business using.
    await expect(
      multiHarness.createConversation({ conversationId: 'conv-legacy' } as CreateConversationParams),
    ).rejects.toThrow();
  }, 15_000);
});

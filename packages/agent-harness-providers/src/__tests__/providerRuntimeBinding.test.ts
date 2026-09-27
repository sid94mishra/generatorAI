// ────────────────────────────────────────────────────────────────
// W34 — ProviderRuntimeBinding and the delete-an-instance criterion.
//
// Track 3's acceptance criterion for W34 reads, verbatim:
//
//   "a thread whose configured instance has been deleted refuses to resume
//    and starts a new provider session, rather than resuming against a
//    different account — asserted by a test that deletes an instance and
//    replays a thread."
//
// Before this fix that test could not pass. `ProviderInstanceRegistry`
// recorded ownership as a bare `conversationId → instanceId` map and
// `resolveForConversation()` returned the INSTANCE, so a deleted account and a
// never-bound thread were indistinguishable — both yielded `undefined`.
// `MultiHarness.resolveInstance()` therefore returned `undefined` for a
// deleted account and `adapterFor()` fell through to
// `registry.get(this.ownerOf(id))`, handing the thread to a different account
// of the same driver. That is the exact failure the criterion forbids.
//
// The routing assertions below run against TWO REAL ACP agent child processes
// (the same fixture `multiInstance.test.ts` uses), so a regression shows up as
// a real session being resumed on the wrong process, not as a mock returning
// the wrong string.
// ────────────────────────────────────────────────────────────────

/* W34 */

import { describe, expect, it, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { HarnessRegistry } from '../HarnessRegistry.js';
import { MultiHarness, ProviderInstanceUnavailableError } from '../MultiHarness.js';
import { ProviderInstanceRegistry } from '../ProviderInstanceRegistry.js';
import type { ProviderInstanceStore, ProviderRuntimeBinding } from '../ProviderInstanceRegistry.js';
import { makeProviderInstanceId } from '@generatorai/core';
import type { CreateConversationParams, IProviderInstance, ProviderInstanceId } from '@generatorai/core';

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

const NO_CAPABILITIES = {
  vision: false,
  reasoning: false,
  reasoningEfforts: [],
  planMode: false,
  mcpServers: false,
  approvalGating: 'none',
  hostTools: 'none',
  structuredOutput: 'none',
  skills: 'none',
  sessionPersistence: false,
  budgetTracking: false,
} as const;

function instance(id: ProviderInstanceId, displayName: string): IProviderInstance {
  return {
    id,
    driverType: 'acp',
    protocol: 'acp',
    displayName,
    capabilities: { ...NO_CAPABILITIES },
    enabled: true,
  };
}

/**
 * The type-level fallback adapter is deliberately given a WORKING config.
 *
 * This is what makes the refusal test meaningful: if the fallback could not
 * run, the pre-fix code would have thrown anyway and the test would pass for
 * the wrong reason. With a live fallback, the pre-fix code happily services
 * the orphaned thread on the wrong adapter — so the test fails before the fix
 * and passes after it, which is the only version of it worth having.
 */
function makeHarnessRegistry(): HarnessRegistry {
  return new HarnessRegistry({
    buildConfig: () => ({
      type: 'acp',
      acp: { command: process.execPath, args: [FIXTURE_AGENT] },
    }),
    primary: 'acp',
  });
}

const WORK = makeProviderInstanceId('acp:work');
const PERSONAL = makeProviderInstanceId('acp:personal');

describe('W34 — ProviderRuntimeBinding shape', () => {
  it('assignConversation records the full binding, not just an instance id', async () => {
    const registry = new ProviderInstanceRegistry();
    registry.register(instance(WORK, 'ACP (work)'));

    await registry.assignConversation('thread-1', WORK);

    const binding = registry.bindingFor('thread-1');
    // The seven-field shape Track 3 specifies. The pre-fix storage carried
    // only two of these (conversation_id, instance_id).
    expect(binding).toMatchObject({
      threadId: 'thread-1',
      provider: 'acp',
      providerInstanceId: WORK,
      adapterKey: 'acp',
      runtimeMode: 'acp',
      bindingOrigin: 'explicit',
    });
  });

  it('keeps the binding after the instance is deleted, so the thread stays distinguishable', async () => {
    const registry = new ProviderInstanceRegistry();
    registry.register(instance(WORK, 'ACP (work)'));
    registry.register(instance(PERSONAL, 'ACP (personal)'));
    await registry.assignConversation('thread-1', WORK);

    expect(registry.unregister(WORK)).toBe(true);

    // `resolveForConversation` still answers undefined — it returns the
    // instance, which really is gone. The binding is what survives, and it is
    // the only thing that tells a deleted account apart from no account.
    expect(registry.resolveForConversation('thread-1')).toBeUndefined();
    expect(registry.bindingFor('thread-1')?.providerInstanceId).toBe(WORK);
    expect(registry.orphanedBindingFor('thread-1')).toEqual({
      binding: expect.objectContaining({ providerInstanceId: WORK }),
      missingInstanceId: WORK,
    });

    // A thread that was never bound must NOT look orphaned — otherwise every
    // legacy conversation would refuse to route.
    expect(registry.orphanedBindingFor('never-bound')).toBeNull();
  });
});

describe('W34 — migration promotion rules (REV2)', () => {
  function storeWith(rows: Array<{ conversationId: string; instanceId: string }>): ProviderInstanceStore {
    return {
      load: async () => rows,
      save: async () => undefined,
      remove: async () => undefined,
    };
  }

  it('promotes a legacy row to `migrated-unambiguous` when exactly one instance of the driver exists', async () => {
    const registry = new ProviderInstanceRegistry(
      storeWith([{ conversationId: 'legacy-1', instanceId: 'acp:gone' }]),
    );
    registry.register(instance(WORK, 'ACP (work)'));

    await registry.hydrate();

    expect(registry.bindingFor('legacy-1')).toMatchObject({
      providerInstanceId: WORK,
      bindingOrigin: 'migrated-unambiguous',
    });
  });

  it('records `migrated-ambiguous` when several instances of the driver exist, so the UI can surface the guess', async () => {
    const registry = new ProviderInstanceRegistry(
      storeWith([{ conversationId: 'legacy-1', instanceId: 'acp:gone' }]),
    );
    registry.register(instance(WORK, 'ACP (work)'));
    registry.register(instance(PERSONAL, 'ACP (personal)'));

    await registry.hydrate();

    const binding = registry.bindingFor('legacy-1');
    expect(binding?.bindingOrigin).toBe('migrated-ambiguous');
    // It bound to the driver's default (the primary), not to an arbitrary one.
    expect(binding?.providerInstanceId).toBe(WORK);
  });

  it('leaves a row UNBOUND when the driver is unknown, rather than guessing', async () => {
    const registry = new ProviderInstanceRegistry(
      storeWith([{ conversationId: 'legacy-1', instanceId: 'codex:gone' }]),
    );
    registry.register(instance(WORK, 'ACP (work)'));

    await registry.hydrate();

    // REV2: "an unbound thread must never resume with someone else's cursor."
    // Binding a codex thread to the only ACP account would do exactly that.
    expect(registry.bindingFor('legacy-1')).toBeUndefined();
    expect(registry.orphanedBindingFor('legacy-1')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// B1 — the binding must survive a restart, and unbinding must too.
//
// `hydrate()` had a full-shape path from the day it was written, but the only
// store in the product implemented neither `loadBindings` nor `saveBinding`,
// so it was never exercised. These tests pin the two halves of the round trip
// against a store that DOES implement them — plus the two gaps that only
// become visible once the store is durable:
//
//   1. a store can hold BOTH full-shape and legacy rows (any DB written before
//      the full shape existed does), and the legacy ones must still be promoted
//      rather than silently dropped;
//   2. `clearBinding` must reach the store, or a delete/rebind is undone by the
//      next restart and the thread refuses to route forever.
// ────────────────────────────────────────────────────────────────

describe('W34 — binding persistence round trip (B1)', () => {
  /**
   * A durable store that keeps rows in a plain object, so a "restart" is a new
   * registry over the SAME rows — exactly what the SQLite repository does with
   * a file. Nothing survives in the registry itself.
   */
  function durableStore(seed: Record<string, ProviderRuntimeBinding> = {}) {
    const rows: Record<string, ProviderRuntimeBinding> = { ...seed };
    const legacyOnly: Record<string, string> = {};
    return {
      rows,
      legacyOnly,
      store: {
        load: async () => [
          ...Object.values(rows).map((b) => ({
            conversationId: b.threadId,
            instanceId: b.providerInstanceId as string,
          })),
          ...Object.entries(legacyOnly).map(([conversationId, instanceId]) => ({
            conversationId,
            instanceId,
          })),
        ],
        save: async (conversationId: string, instanceId: string) => {
          legacyOnly[conversationId] = instanceId;
        },
        remove: async (conversationId: string) => {
          delete rows[conversationId];
          delete legacyOnly[conversationId];
        },
        loadBindings: async () => Object.values(rows),
        saveBinding: async (binding: ProviderRuntimeBinding) => {
          rows[binding.threadId] = binding;
        },
      } satisfies ProviderInstanceStore,
    };
  }

  it('restores every binding field after the in-memory state is dropped', async () => {
    const { store, rows } = durableStore();

    const before = new ProviderInstanceRegistry(store);
    before.register(instance(WORK, 'ACP (work)'));
    await before.assignConversation('thread-1', WORK);

    // The full shape reached the store — not just the two-column pair.
    expect(rows['thread-1']).toMatchObject({
      threadId: 'thread-1',
      provider: 'acp',
      providerInstanceId: WORK,
      adapterKey: 'acp',
      runtimeMode: 'acp',
      bindingOrigin: 'explicit',
    });

    // Restart: a brand-new registry, nothing carried over but the store.
    const after = new ProviderInstanceRegistry(store);
    after.register(instance(WORK, 'ACP (work)'));
    await after.hydrate();

    expect(after.bindingFor('thread-1')).toEqual(before.bindingFor('thread-1'));
    // And specifically: the origin is the one that was WRITTEN, not one
    // re-derived by the promotion rules, which would say 'migrated-*'.
    expect(after.bindingFor('thread-1')?.bindingOrigin).toBe('explicit');
  });

  it('replays an opaque resume cursor and payload verbatim after a restart', async () => {
    const { store, rows } = durableStore({
      'thread-1': {
        threadId: 'thread-1',
        provider: 'acp',
        providerInstanceId: WORK,
        adapterKey: 'acp',
        resumeCursor: 'opaque-cursor-xyz',
        runtimePayload: { cwd: '/srv/app' },
        runtimeMode: 'acp',
        bindingOrigin: 'explicit',
      },
    });

    const registry = new ProviderInstanceRegistry(store);
    registry.register(instance(WORK, 'ACP (work)'));
    await registry.hydrate();

    expect(registry.bindingFor('thread-1')).toEqual(rows['thread-1']);
  });

  it('still promotes legacy rows when the store ALSO returns full-shape bindings', async () => {
    const { store } = durableStore({
      'thread-full': {
        threadId: 'thread-full',
        provider: 'acp',
        providerInstanceId: WORK,
        adapterKey: 'acp',
        bindingOrigin: 'explicit',
      },
    });
    await store.save('thread-legacy', 'acp:gone'); // pre-full-shape row

    const registry = new ProviderInstanceRegistry(store);
    registry.register(instance(WORK, 'ACP (work)'));
    await registry.hydrate();

    expect(registry.bindingFor('thread-full')?.bindingOrigin).toBe('explicit');
    // The legacy row must NOT be dropped just because a full-shape read path
    // exists — that is every pre-W34 conversation in a real database.
    expect(registry.bindingFor('thread-legacy')).toMatchObject({
      providerInstanceId: WORK,
      bindingOrigin: 'migrated-unambiguous',
    });
  });

  it('a full-shape row wins over the legacy promotion for the same thread', async () => {
    const { store } = durableStore({
      'thread-1': {
        threadId: 'thread-1',
        provider: 'acp',
        providerInstanceId: PERSONAL,
        adapterKey: 'acp',
        resumeCursor: 'cursor-personal',
        bindingOrigin: 'explicit',
      },
    });

    const registry = new ProviderInstanceRegistry(store);
    registry.register(instance(WORK, 'ACP (work)'));
    registry.register(instance(PERSONAL, 'ACP (personal)'));
    await registry.hydrate();

    // `load()` returns this thread too. Re-promoting it would rewrite a
    // user-chosen binding as a guess and could move it to another account.
    expect(registry.bindingFor('thread-1')).toMatchObject({
      providerInstanceId: PERSONAL,
      resumeCursor: 'cursor-personal',
      bindingOrigin: 'explicit',
    });
  });

  it('clearBinding removes the row durably, so a restart does not resurrect it', async () => {
    const { store, rows } = durableStore();

    const before = new ProviderInstanceRegistry(store);
    before.register(instance(WORK, 'ACP (work)'));
    await before.assignConversation('thread-1', WORK);
    expect(rows['thread-1']).toBeDefined();

    // The thread is deleted, or rebound after its account was removed.
    before.clearBinding('thread-1');
    await Promise.resolve(); // let the durable delete settle

    expect(rows['thread-1']).toBeUndefined();

    const after = new ProviderInstanceRegistry(store);
    after.register(instance(WORK, 'ACP (work)'));
    await after.hydrate();
    // Pre-fix the row survived the clear and came back as an orphan on the
    // next boot — a thread that refuses to route, permanently.
    expect(after.bindingFor('thread-1')).toBeUndefined();
  });
});

describe('W34 — deleting an instance and replaying a thread (the acceptance criterion)', () => {
  const registries: HarnessRegistry[] = [];

  afterEach(async () => {
    await Promise.all(registries.splice(0).map((r) => r.shutdownAll()));
  });

  async function boot() {
    const harnessRegistry = makeHarnessRegistry();
    registries.push(harnessRegistry);
    for (const id of [WORK, PERSONAL]) {
      harnessRegistry.registerInstance(id, 'acp', {
        type: 'acp',
        acp: { command: process.execPath, args: [FIXTURE_AGENT] },
      });
    }
    const instanceRegistry = new ProviderInstanceRegistry();
    instanceRegistry.register(instance(WORK, 'ACP (work)'));
    instanceRegistry.register(instance(PERSONAL, 'ACP (personal)'));
    const multiHarness = new MultiHarness(harnessRegistry, undefined, undefined, instanceRegistry);
    return { harnessRegistry, instanceRegistry, multiHarness };
  }

  it('refuses to route a thread whose instance was deleted, instead of falling back to another account', async () => {
    const { instanceRegistry, multiHarness } = await boot();

    const threadId = await multiHarness.createConversation({
      conversationId: 'conv-work',
      providerInstanceId: WORK,
    } as CreateConversationParams);
    expect(instanceRegistry.resolveForConversation(threadId)?.id).toBe(WORK);

    // The user deletes the "work" account.
    instanceRegistry.unregister(WORK);

    // Pre-fix this resolved to the `personal` adapter and happily ran the
    // prompt against the wrong account. It must now fail loudly.
    await expect(multiHarness.sendPromptAndWait(threadId, 'replay')).rejects.toThrow(
      ProviderInstanceUnavailableError,
    );
    await expect(multiHarness.sendPromptAndWait(threadId, 'replay')).rejects.toThrow(
      /no longer configured/i,
    );

    // And it must not claim the surviving account's session as this thread's.
    expect(multiHarness.hasLiveConversation(threadId)).toBe(false);
  }, 20_000);

  it('resumeConversation starts a NEW provider session rather than replaying the cursor elsewhere', async () => {
    const { harnessRegistry, instanceRegistry, multiHarness } = await boot();

    const threadId = await multiHarness.createConversation({
      conversationId: 'conv-work',
      providerInstanceId: WORK,
    } as CreateConversationParams);

    const workAdapter = await harnessRegistry.getInstance(WORK);
    expect(workAdapter.hasLiveConversation(threadId)).toBe(true);

    instanceRegistry.unregister(WORK);

    // The criterion's second half: it "starts a new provider session".
    await multiHarness.resumeConversation(threadId, {
      conversationId: threadId,
    } as CreateConversationParams);

    // The stale binding is gone, so the thread is routable again...
    expect(instanceRegistry.orphanedBindingFor(threadId)).toBeNull();
    expect(instanceRegistry.bindingFor(threadId)).toBeUndefined();

    // ...on a FRESH session, created via createConversation, never via the
    // deleted account's resume cursor.
    const response = await multiHarness.sendPromptAndWait(threadId, 'hello after rebind');
    expect(response.content).toContain('Hello from fake agent.');
  }, 20_000);

  it('still allows a thread bound to a deleted instance to be deleted', async () => {
    const { instanceRegistry, multiHarness } = await boot();

    const threadId = await multiHarness.createConversation({
      conversationId: 'conv-work',
      providerInstanceId: WORK,
    } as CreateConversationParams);
    instanceRegistry.unregister(WORK);

    // Teardown must not be blocked by the refusal, or the row is stranded.
    await expect(multiHarness.deleteConversation(threadId)).resolves.toBeUndefined();
    expect(instanceRegistry.bindingFor(threadId)).toBeUndefined();
  }, 20_000);

  it('leaves an UNBOUND thread on the unchanged type-level fallback path', async () => {
    const { harnessRegistry, instanceRegistry, multiHarness } = await boot();

    // Created without a providerInstanceId — no binding is ever recorded, so
    // the pre-W34 `owners` map is the only routing table. This must keep
    // working: the refusal is for deleted accounts, not for legacy threads.
    const threadId = await multiHarness.createConversation({
      conversationId: 'conv-legacy',
      harnessType: 'acp',
    } as CreateConversationParams);

    expect(instanceRegistry.bindingFor(threadId)).toBeUndefined();
    expect(instanceRegistry.orphanedBindingFor(threadId)).toBeNull();
    const response = await multiHarness.sendPromptAndWait(threadId, 'legacy path');
    expect(response.content).toContain('Hello from fake agent.');
    expect(harnessRegistry).toBeDefined();
  }, 20_000);
});

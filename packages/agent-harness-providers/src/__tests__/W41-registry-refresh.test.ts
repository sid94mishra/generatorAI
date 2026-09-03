// ────────────────────────────────────────────────────────────────
// W41-registry-refresh.test.ts
//
// Four W41 requirements that were specified but never built. Each block pins
// one, and each drives the shipped `HarnessRegistry` rather than a copy.
//
//  1. GENERATIONAL ENRICHMENT — status writes were unconditional, so the
//     source that finished LAST won. The slowest source is systematically the
//     stalest one: `loadDiskCache()` does real file I/O while `refresh()` runs
//     in memory, so an hour-old cached verdict routinely landed on top of a
//     fresh live probe.
//  2. WATCHER-GATED REFRESH — there was no way to be told about a status
//     change (only `statusSnapshot`, a pure read that never refreshes), and no
//     periodic refresh that could be switched off when nobody is looking.
//  3. NON-THROWING getModels() — one misconfigured provider took the whole
//     catalog refresh with it.
//  4. CACHE KEYED ON instance ∧ driver ∧ enabled — a readiness verdict
//     measured for one account was replayed for another account of the same
//     driver, and for accounts since disabled.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessRegistry, statusCacheKey, type HarnessProviderStatus } from '../HarnessRegistry.js';
import type { HarnessType } from '../types.js';
import type { IAgentHarness, HarnessModel, ProviderInstanceId } from '@generatorai/core';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'w41-registry-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const iid = (s: string) => s as ProviderInstanceId;

/**
 * A registry whose adapters are stubs, so a "probe" is a function call rather
 * than a CLI spawn. `getAdapter` lets a test decide what each type answers.
 */
function makeRegistry(opts: {
  diskCacheFile?: string;
  statusTtlMs?: number;
  getAdapter?: (type: HarnessType) => IAgentHarness;
}): HarnessRegistry {
  const registry = new HarnessRegistry({
    primary: 'copilot',
    statusTtlMs: opts.statusTtlMs ?? 5 * 60_000,
    ...(opts.diskCacheFile ? { diskCacheFile: opts.diskCacheFile } : {}),
    buildConfig: (type) => ({ type }),
  });
  const cache = new Map<HarnessType, IAgentHarness>();
  const build = opts.getAdapter ?? ((type: HarnessType) => stub([{ id: `${type}-model`, name: type, provider: type }]));
  (registry as unknown as { get(t: HarnessType): Promise<IAgentHarness> }).get = async (type) => {
    let a = cache.get(type);
    if (!a) { a = build(type); cache.set(type, a); }
    return a;
  };
  return registry;
}

function stub(models: HarnessModel[], extra: Partial<IAgentHarness> = {}): IAgentHarness {
  return {
    initialize: async () => { /* nothing to start */ },
    getModels: async () => models,
    shutdown: async () => { /* nothing to stop */ },
    ...extra,
  } as unknown as IAgentHarness;
}

// ── 1. Generational enrichment ──

describe('W41 — a superseded generation never overwrites a newer one', () => {
  it('a slow disk-cache seed does not clobber the live probe that already landed', async () => {
    const file = join(dir, 'cache.json');
    // A STALE cached verdict: copilot ready with an obsolete catalog.
    await writeFile(file, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      statuses: [{
        type: 'copilot', label: 'GitHub Copilot',
        installed: true, connected: true, authenticated: true, ready: true,
        models: [{ id: 'stale-model', name: 'stale', provider: 'copilot' }],
        checkedAt: Date.now(),
      }],
    }), 'utf8');

    const registry = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });

    // Start the file read FIRST, then run a live refresh that completes in
    // microtasks. `readFile` needs at least one macrotask, so the seed lands
    // last — which, before generational guarding, meant it WON.
    const seeding = registry.loadDiskCache();
    await registry.refresh(true);
    await seeding;

    const copilot = registry.statusSnapshot['copilot'];
    expect(copilot.models.map((m) => m.id)).toEqual(['copilot-model']); // live, not 'stale-model'
    expect(copilot.fromDiskCache).toBe(false);
  });

  it('a live probe still supersedes a seed that landed first', async () => {
    const file = join(dir, 'cache.json');
    await writeFile(file, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      statuses: [{
        type: 'copilot', label: 'GitHub Copilot',
        installed: true, connected: true, authenticated: true, ready: true,
        models: [{ id: 'stale-model', name: 'stale', provider: 'copilot' }],
        checkedAt: Date.now(),
      }],
    }), 'utf8');

    const registry = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    await registry.loadDiskCache();
    expect(registry.statusSnapshot['copilot'].models.map((m) => m.id)).toEqual(['stale-model']);

    await registry.refresh(true);
    expect(registry.statusSnapshot['copilot'].models.map((m) => m.id)).toEqual(['copilot-model']);
  });
});

// ── 2. Watcher-gated refresh ──

describe('W41 — refresh runs only while something is watching', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('starts no timer until a watcher attaches, and stops it when the last one leaves', () => {
    vi.useFakeTimers();
    const registry = makeRegistry({ statusTtlMs: 1_000 });
    expect(registry.watcherCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    const stopA = registry.watchStatus(() => { /* observer */ });
    const stopB = registry.watchStatus(() => { /* observer */ });
    expect(registry.watcherCount).toBe(2);
    // ONE timer for any number of watchers.
    expect(vi.getTimerCount()).toBe(1);

    stopA();
    expect(vi.getTimerCount()).toBe(1); // B is still watching
    stopB();
    expect(registry.watcherCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0); // nobody watching → no work scheduled
  });

  it('unsubscribing twice is safe and does not disturb other watchers', () => {
    vi.useFakeTimers();
    const registry = makeRegistry({ statusTtlMs: 1_000 });
    const stopA = registry.watchStatus(() => { /* observer */ });
    registry.watchStatus(() => { /* observer */ });
    stopA();
    stopA();
    expect(registry.watcherCount).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('hands the watcher the current verdict immediately, then again after a refresh', async () => {
    const registry = makeRegistry({ statusTtlMs: 60_000 });
    const seen: HarnessProviderStatus[][] = [];
    const stop = registry.watchStatus((s) => seen.push(s));
    expect(seen.length).toBe(1); // Ref-style: the current value, synchronously

    await registry.refresh(true);
    expect(seen.length).toBe(2);
    expect(seen[1]!.find((s) => s.type === 'copilot')!.ready).toBe(true);
    stop();
  });

  it('statusSnapshot stays a pure read — it never probes', () => {
    let probes = 0;
    const registry = makeRegistry({
      statusTtlMs: 1,
      getAdapter: () => stub([], { getModels: async () => { probes++; return []; } } as Partial<IAgentHarness>),
    });
    for (let i = 0; i < 20; i++) void registry.statusSnapshot;
    expect(probes).toBe(0);
  });

  it('shutdownAll drops watchers and their timer', async () => {
    vi.useFakeTimers();
    const registry = makeRegistry({ statusTtlMs: 1_000 });
    registry.watchStatus(() => { /* observer */ });
    expect(vi.getTimerCount()).toBe(1);
    await registry.shutdownAll();
    expect(registry.watcherCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ── 3. getModels() must never throw ──

describe('W41 — one misconfigured provider does not take the catalog down', () => {
  it('a provider whose getModels() throws is reported unusable, and the other still works', async () => {
    const registry = makeRegistry({
      statusTtlMs: 60_000,
      getAdapter: (type) =>
        type === 'claude-agent'
          ? stub([], { getModels: async () => { throw new Error('CLI not installed'); } } as Partial<IAgentHarness>)
          : stub([{ id: 'copilot-model', name: 'c', provider: 'copilot' }]),
    });

    // `refresh` must resolve, not reject — boot cannot fail on one provider.
    await expect(registry.refresh(true)).resolves.toBeTruthy();
    expect(registry.readyTypes).toEqual(['copilot']);
    expect(registry.statusSnapshot['claude-agent'].error).toContain('CLI not installed');
    await expect(registry.getAllModels()).resolves.toEqual([
      expect.objectContaining({ id: 'copilot-model' }),
    ]);
  });

  it('recovers the reason for an EMPTY catalog from a non-throwing provider', async () => {
    // This is the shape the real providers now have: getModels() returns [] and
    // records why. Without `getLastModelProbeError` the status would say only
    // "not ready", which is indistinguishable from a valid empty entitlement.
    const registry = makeRegistry({
      statusTtlMs: 60_000,
      getAdapter: (type) =>
        type === 'claude-agent'
          ? stub([], {
              getModels: async () => [],
              getLastModelProbeError: () => 'Claude CLI probe timed out',
            } as unknown as Partial<IAgentHarness>)
          : stub([{ id: 'copilot-model', name: 'c', provider: 'copilot' }]),
    });

    await registry.refresh(true);
    expect(registry.statusSnapshot['claude-agent'].ready).toBe(false);
    expect(registry.statusSnapshot['claude-agent'].error).toBe('Claude CLI probe timed out');
  });
});

// ── 4. Cache keyed on instance ∧ driver ∧ enabled ──

describe('W41 — a cached verdict is keyed on instance ∧ driver ∧ enabled', () => {
  const workConfig = { type: 'copilot' as HarnessType };

  async function persistedPayload(file: string): Promise<{
    statuses: HarnessProviderStatus[];
    instances?: Array<{ instanceId: string; driverType: string; enabled: boolean; status: HarnessProviderStatus }>;
  }> {
    return JSON.parse(await readFile(file, 'utf8'));
  }

  it('writes an identity alongside every verdict', async () => {
    const file = join(dir, 'cache.json');
    const registry = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    registry.registerInstance(iid('copilot:work'), 'copilot', workConfig, true);
    await registry.refresh(true);
    await registry.getAllModels(true);
    await new Promise((r) => setTimeout(r, 150));

    const payload = await persistedPayload(file);
    // Driver-level rows carry the driver identity…
    expect(payload.statuses.find((s) => s.type === 'copilot')!.cacheKey)
      .toBe(statusCacheKey({ driverType: 'copilot', enabled: true }));
    // …and per-account rows carry the account identity, which is the whole
    // point: two accounts of one driver are now distinguishable in the cache.
    expect(payload.instances?.find((i) => i.instanceId === 'copilot:work')!.status.cacheKey)
      .toBe(statusCacheKey({ driverType: 'copilot', instanceId: iid('copilot:work'), enabled: true }));
  });

  it('does NOT replay one account\'s verdict for a different account', async () => {
    const file = join(dir, 'cache.json');
    await writeFile(file, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      statuses: [],
      instances: [{
        instanceId: 'copilot:work',
        driverType: 'copilot',
        enabled: true,
        status: {
          type: 'copilot', label: 'work', installed: true, connected: true,
          authenticated: true, ready: true,
          models: [{ id: 'work-model', name: 'w', provider: 'copilot' }],
          checkedAt: Date.now(),
          cacheKey: statusCacheKey({ driverType: 'copilot', instanceId: iid('copilot:work'), enabled: true }),
        },
      }],
    }), 'utf8');

    const registry = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    // A DIFFERENT account of the same driver.
    registry.registerInstance(iid('copilot:personal'), 'copilot', workConfig, true);
    await registry.loadDiskCache();

    // Nothing was seeded for the personal account: the cached verdict belongs
    // to the work account and says nothing about this one.
    expect(registry.hasInstance(iid('copilot:personal'))).toBe(true);
    expect(registry.hasInstance(iid('copilot:work'))).toBe(false);
  });

  it('does NOT replay a verdict measured while the instance was ENABLED once it is disabled', async () => {
    const file = join(dir, 'cache.json');
    await writeFile(file, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      statuses: [],
      instances: [{
        instanceId: 'copilot:work',
        driverType: 'copilot',
        enabled: true,
        status: {
          type: 'copilot', label: 'work', installed: true, connected: true,
          authenticated: true, ready: true,
          models: [{ id: 'work-model', name: 'w', provider: 'copilot' }],
          checkedAt: Date.now(),
          cacheKey: statusCacheKey({ driverType: 'copilot', instanceId: iid('copilot:work'), enabled: true }),
        },
      }],
    }), 'utf8');

    const registry = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    registry.registerInstance(iid('copilot:work'), 'copilot', workConfig, false); // now disabled
    await registry.loadDiskCache();

    expect(registry.isInstanceEnabled(iid('copilot:work'))).toBe(false);
    // The ready verdict is NOT restored for a disabled account.
    const status = (registry as unknown as {
      instanceEntries: Map<ProviderInstanceId, { status: HarnessProviderStatus }>;
    }).instanceEntries.get(iid('copilot:work'))!.status;
    expect(status.ready).toBe(false);
    expect(status.models).toEqual([]);
  });

  it('DOES replay a verdict whose identity matches exactly', async () => {
    const file = join(dir, 'cache.json');
    await writeFile(file, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      statuses: [],
      instances: [{
        instanceId: 'copilot:work',
        driverType: 'copilot',
        enabled: true,
        status: {
          type: 'copilot', label: 'work', installed: true, connected: true,
          authenticated: true, ready: true,
          models: [{ id: 'work-model', name: 'w', provider: 'copilot' }],
          checkedAt: Date.now(),
          cacheKey: statusCacheKey({ driverType: 'copilot', instanceId: iid('copilot:work'), enabled: true }),
        },
      }],
    }), 'utf8');

    const registry = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    registry.registerInstance(iid('copilot:work'), 'copilot', workConfig, true);
    await registry.loadDiskCache();

    const status = (registry as unknown as {
      instanceEntries: Map<ProviderInstanceId, { status: HarnessProviderStatus }>;
    }).instanceEntries.get(iid('copilot:work'))!.status;
    expect(status.ready).toBe(true);
    expect(status.models.map((m) => m.id)).toEqual(['work-model']);
    expect(status.fromDiskCache).toBe(true);
  });

  it('rejects a driver-level verdict whose key names a different identity', async () => {
    const file = join(dir, 'cache.json');
    await writeFile(file, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      statuses: [{
        type: 'copilot', label: 'GitHub Copilot',
        installed: true, connected: true, authenticated: true, ready: true,
        models: [{ id: 'foreign', name: 'f', provider: 'copilot' }],
        checkedAt: Date.now(),
        // Written for a specific account, not for the driver-level entry.
        cacheKey: statusCacheKey({ driverType: 'copilot', instanceId: iid('copilot:work'), enabled: true }),
      }],
    }), 'utf8');

    const registry = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    await registry.loadDiskCache();
    expect(registry.statusSnapshot['copilot'].ready).toBe(false);
  });

  it('still accepts a pre-W41 file that carries no identity at all', async () => {
    // Backward compatibility: an upgrading user must not pay a cold boot. Such
    // files age out within DISK_CACHE_MAX_AGE_MS (1 h).
    const file = join(dir, 'cache.json');
    await writeFile(file, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      statuses: [{
        type: 'copilot', label: 'GitHub Copilot',
        installed: true, connected: true, authenticated: true, ready: true,
        models: [{ id: 'legacy', name: 'l', provider: 'copilot' }],
        checkedAt: Date.now(),
      }],
    }), 'utf8');

    const registry = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    await registry.loadDiskCache();
    expect(registry.statusSnapshot['copilot'].ready).toBe(true);
  });
});

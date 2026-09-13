// ────────────────────────────────────────────────────────────────
// HarnessRegistry — W41 staleness & disk-cache regression tests
// ────────────────────────────────────────────────────────────────
//
// Three defects, each pinned by its own describe block:
//
//  1. Staleness was computed over ALL FIVE provider types, but `refresh()`
//     only ever probes copilot and claude-agent — so codex/opencode/acp never
//     got a `checkedAt` and were permanently stale. Every `getAllModels()` and
//     every `resolveProviderForModel()` therefore fired a background refresh
//     whose success path rewrites the entire disk cache. The 5-minute TTL
//     suppressed nothing at all.
//  2. `persistDiskCache()` was a bare `writeFile` with no tmp+rename, invoked
//     fire-and-forget from three call sites, so two writes could interleave
//     and a reader could see a half-written document.
//  3. `loadDiskCache()` deliberately left `ready: false`, but every consumer
//     filters on `ready` — so the seeded catalog was unreachable and the cache
//     bought a cold boot precisely nothing.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessRegistry, ALL_HARNESS_TYPES, type HarnessProviderStatus } from '../HarnessRegistry.js';
import type { HarnessType } from '../types.js';
import type { IAgentHarness, HarnessModel } from '@generatorai/core';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'harness-registry-')); });
// Retries: a routing lookup kicks off a background refresh whose disk-cache
// write can land while the directory is being removed (ENOTEMPTY / EBUSY).
afterEach(async () => { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

/** A harness stub that answers `getModels()` and counts how often it is asked. */
function stubHarness(models: HarnessModel[], onGetModels: () => void): IAgentHarness {
  return {
    initialize: async () => { /* nothing to start */ },
    getModels: async () => { onGetModels(); return models; },
    shutdown: async () => { /* nothing to stop */ },
  } as unknown as IAgentHarness;
}

/**
 * A registry whose provider construction is fully stubbed, so a "probe" is a
 * function call rather than a CLI spawn. `probes` records every probe by type.
 */
function makeRegistry(opts: {
  diskCacheFile?: string;
  statusTtlMs?: number;
  models?: Partial<Record<HarnessType, HarnessModel[]>>;
}): { registry: HarnessRegistry; probes: HarnessType[] } {
  const probes: HarnessType[] = [];
  const registry = new HarnessRegistry({
    primary: 'copilot',
    statusTtlMs: opts.statusTtlMs ?? 5 * 60_000,
    ...(opts.diskCacheFile ? { diskCacheFile: opts.diskCacheFile } : {}),
    buildConfig: (type) => ({ type }),
  });
  // `createHarnessProvider` would spawn a real CLI; swap the one private hook
  // the registry uses to obtain an adapter.
  const original = (registry as unknown as { get(t: HarnessType): Promise<IAgentHarness> }).get;
  void original;
  const adapters = new Map<HarnessType, IAgentHarness>();
  (registry as unknown as { get(t: HarnessType): Promise<IAgentHarness> }).get = async (type) => {
    let a = adapters.get(type);
    if (!a) {
      a = stubHarness(opts.models?.[type] ?? [{ id: `${type}-model`, name: type, provider: type }], () => {
        probes.push(type);
      });
      adapters.set(type, a);
    }
    return a;
  };
  return { registry, probes };
}

/** Poll until `fn()` is true or the budget runs out. */
async function waitFor(fn: () => boolean | Promise<boolean>, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !(await fn())) await new Promise((r) => setTimeout(r, 10));
}

// ── Defect 1: the TTL suppressed nothing ──

describe('HarnessRegistry — a fresh snapshot suppresses the background refresh', () => {
  it('does not re-probe on repeated getAllModels() calls inside the TTL', async () => {
    const { registry, probes } = makeRegistry({ statusTtlMs: 60_000 });
    await registry.refresh(true);
    const afterFirst = probes.length;
    expect(afterFirst).toBe(2); // copilot + claude-agent

    // Before the fix, codex/opencode/acp had no `checkedAt` and so were
    // permanently stale — every one of these calls kicked off a full refresh
    // AND a full disk-cache rewrite.
    for (let i = 0; i < 10; i++) await registry.getAllModels();
    for (let i = 0; i < 10; i++) await registry.resolveProviderForModel('copilot-model');
    await new Promise((r) => setTimeout(r, 100)); // let any background work land

    expect(probes.length).toBe(afterFirst);
  });

  it('still refreshes once the TTL has actually elapsed', async () => {
    const { registry, probes } = makeRegistry({ statusTtlMs: 50 });
    await registry.refresh(true);
    const afterFirst = probes.length;
    await new Promise((r) => setTimeout(r, 80));
    await registry.getAllModels();
    await waitFor(() => probes.length > afterFirst);
    expect(probes.length).toBeGreaterThan(afterFirst);
  });

  it('the un-probed provider types are not what makes the snapshot stale', () => {
    // Guards the shape of the fix: codex/opencode/acp are in ALL_HARNESS_TYPES
    // (so `get()` can reach them) but are not auto-probed, so they must not
    // participate in the staleness decision.
    expect(ALL_HARNESS_TYPES).toContain('codex');
    expect(ALL_HARNESS_TYPES).toContain('opencode');
    expect(ALL_HARNESS_TYPES).toContain('acp');
  });
});

// ── Defect 2: non-atomic, self-racing disk writes ──

describe('HarnessRegistry — the disk cache is written atomically', () => {
  it('never leaves a partial file behind, even under overlapping writes', async () => {
    const file = join(dir, 'cache.json');
    const { registry } = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    await registry.refresh(true);

    // Three concurrent forced refreshes → three concurrent persists.
    await Promise.all([registry.getAllModels(true), registry.getAllModels(true), registry.getAllModels(true)]);

    // `getAllModels(true)` persists fire-and-forget, and the three persists are
    // serialised through the write chain — so the file appearing only tells us
    // the FIRST one landed. Waiting on the file alone raced writes 2 and 3 and
    // caught one legitimately mid-flight between `writeFile` and `rename`,
    // which looked like a leaked scratch file and was not.
    //
    // Wait for the whole chain to quiesce instead: a real leak never
    // disappears, so this still fails (after the timeout) if cleanup breaks.
    await waitFor(async () => {
      const written = await readFile(file, 'utf8').catch(() => null);
      if (!written) return false;
      const pending = (await readdir(dir)).filter((f) => f.endsWith('.tmp'));
      return pending.length === 0;
    });

    const raw = await readFile(file, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow(); // a torn write would not parse
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });

    // …and no `.tmp` scratch files are left lying around.
    const leftovers = (await readdir(dir)).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  }, 15_000);
});

// ── Defect 3: the seeded catalog was unreachable ──

describe('HarnessRegistry — a seeded disk cache is usable for routing', () => {
  async function seed(file: string, statuses: Partial<HarnessProviderStatus>[]): Promise<void> {
    await writeFile(file, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      statuses: statuses.map((s) => ({
        type: 'copilot', label: 'GitHub Copilot',
        installed: true, connected: true, authenticated: true, ready: true,
        models: [], checkedAt: Date.now(), ...s,
      })),
    }), 'utf8');
  }

  it('routes a model straight from the cache on a cold boot', async () => {
    const file = join(dir, 'cache.json');
    // Seed BOTH auto-probed types so the snapshot is genuinely fresh and no
    // background refresh is warranted — this is the cold-boot fast path.
    await seed(file, [
      { type: 'copilot', models: [{ id: 'claude-sonnet-4.6', name: 'Sonnet', provider: 'copilot' }] },
      { type: 'claude-agent', label: 'Claude Code', ready: false, authenticated: false, models: [] },
    ]);

    const { registry, probes } = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    await registry.loadDiskCache();

    // Every consumer filters on `ready`. Seeding it false — as the old code
    // did, on purpose — made the cache dead weight: this returned null and the
    // catalog was empty until a ~10 s live probe finished.
    await expect(registry.resolveProviderForModel('claude-sonnet-4.6')).resolves.toBe('copilot');
    await expect(registry.getAllModels()).resolves.toEqual([
      expect.objectContaining({ id: 'claude-sonnet-4.6', provider: 'copilot' }),
    ]);
    expect(registry.readyTypes).toContain('copilot');
    // …and it did so WITHOUT waiting on a probe.
    expect(probes).toEqual([]);
  });

  it('marks the seeded verdict as provisional, and clears that on a live probe', async () => {
    const file = join(dir, 'cache.json');
    await seed(file, [{ type: 'copilot', models: [{ id: 'm', name: 'm', provider: 'copilot' }] }]);
    const { registry } = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    await registry.loadDiskCache();

    expect(registry.statusSnapshot['copilot'].fromDiskCache).toBe(true);
    // `connected` stays false — no process is running yet; `get()` brings one
    // up lazily on first use.
    expect(registry.statusSnapshot['copilot'].connected).toBe(false);

    await registry.refresh(true);
    expect(registry.statusSnapshot['copilot'].fromDiskCache).toBe(false);
    expect(registry.statusSnapshot['copilot'].connected).toBe(true);
  });

  it('does not resurrect a cached NOT-ready provider', async () => {
    const file = join(dir, 'cache.json');
    await seed(file, [{
      type: 'copilot',
      ready: false,
      authenticated: false,
      error: 'Not logged in',
      models: [{ id: 'm', name: 'm', provider: 'copilot' }],
    }]);
    const { registry } = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    await registry.loadDiskCache();
    expect(registry.statusSnapshot['copilot'].ready).toBe(false);
    await expect(registry.resolveProviderForModel('m')).resolves.toBeNull();
  });

  it('ignores a cache file that is too old to trust', async () => {
    const file = join(dir, 'cache.json');
    await writeFile(file, JSON.stringify({
      version: 1,
      savedAt: Date.now() - 3 * 60 * 60_000, // 3 h — past the 1 h ceiling
      statuses: [{
        type: 'copilot', label: 'x', installed: true, connected: true,
        authenticated: true, ready: true, models: [{ id: 'm', name: 'm', provider: 'copilot' }],
      }],
    }), 'utf8');
    const { registry } = makeRegistry({ diskCacheFile: file, statusTtlMs: 60_000 });
    await registry.loadDiskCache();
    expect(registry.statusSnapshot['copilot'].ready).toBe(false);
  });
});

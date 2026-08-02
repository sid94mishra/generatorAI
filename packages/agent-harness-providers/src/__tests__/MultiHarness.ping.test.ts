import { describe, it, expect, vi } from 'vitest';

import { MultiHarness } from '../MultiHarness.js';
import type { HarnessRegistry } from '../HarnessRegistry.js';
import type { HarnessType } from '../types.js';

/**
 * Regression coverage for the "connected provider reported as dead" bug.
 *
 * `MultiHarness.ping()` used to map over `registry.readyTypes`. That list is
 * populated only by `registry.refresh()`, which is driven by the harness-status
 * route — so on a freshly booted server nothing had called it, `readyTypes` was
 * `[]`, and `[].some(Boolean)` returned `false`. `GET /api/health` therefore
 * reported `copilot: false` / `status: degraded` for a provider whose CLI was
 * initialized, authenticated and answering.
 */

interface FakeAdapter {
  ping: () => Promise<boolean>;
}

function makeRegistry(opts: {
  readyTypes?: HarnessType[];
  adapters?: Partial<Record<HarnessType, FakeAdapter | null>>;
}): { registry: HarnessRegistry; get: ReturnType<typeof vi.fn> } {
  const adapters = opts.adapters ?? {};
  const get = vi.fn(async (t: HarnessType) => adapters[t]);
  const registry = {
    readyTypes: opts.readyTypes ?? [],
    primary: 'copilot' as HarnessType,
    peek: (t: HarnessType) => adapters[t] ?? null,
    get,
  } as unknown as HarnessRegistry;
  return { registry, get };
}

describe('MultiHarness.ping', () => {
  it('reports healthy from an initialized adapter even when readyTypes is empty', async () => {
    // The exact boot-time shape: adapter is up, no refresh has run yet.
    const { registry } = makeRegistry({
      readyTypes: [],
      adapters: { copilot: { ping: async () => true } },
    });

    await expect(new MultiHarness(registry).ping()).resolves.toBe(true);
  });

  it('still reports unhealthy when the initialized adapter fails its ping', async () => {
    const { registry } = makeRegistry({
      readyTypes: [],
      adapters: { copilot: { ping: async () => false } },
    });

    await expect(new MultiHarness(registry).ping()).resolves.toBe(false);
  });

  it('treats a throwing ping as unhealthy rather than propagating', async () => {
    const { registry } = makeRegistry({
      readyTypes: [],
      adapters: {
        copilot: {
          ping: async () => {
            throw new Error('runtime connection closed');
          },
        },
      },
    });

    await expect(new MultiHarness(registry).ping()).resolves.toBe(false);
  });

  it('is healthy when any one of several adapters answers', async () => {
    const { registry } = makeRegistry({
      readyTypes: [],
      adapters: {
        copilot: { ping: async () => false },
        'claude-agent': { ping: async () => true },
      },
    });

    await expect(new MultiHarness(registry).ping()).resolves.toBe(true);
  });

  it('reports unhealthy when nothing has been initialized at all', async () => {
    const { registry } = makeRegistry({ readyTypes: [], adapters: {} });

    await expect(new MultiHarness(registry).ping()).resolves.toBe(false);
  });

  it('prefers the refreshed readyTypes verdict once a refresh has run', async () => {
    // `claude-agent` is initialized but NOT ready; refresh says only copilot
    // is usable, so a failing copilot must not be masked by claude-agent.
    const { registry } = makeRegistry({
      readyTypes: ['copilot'],
      adapters: {
        copilot: { ping: async () => false },
        'claude-agent': { ping: async () => true },
      },
    });

    await expect(new MultiHarness(registry).ping()).resolves.toBe(false);
  });

  it('never lazily boots a CLI from the health path', async () => {
    // ping() runs on GET /api/health; calling registry.get() there would spawn
    // a provider CLI on an unauthenticated liveness probe.
    const { registry, get } = makeRegistry({
      readyTypes: ['copilot'],
      adapters: { copilot: { ping: async () => true } },
    });

    await new MultiHarness(registry).ping();

    expect(get).not.toHaveBeenCalled();
  });
});

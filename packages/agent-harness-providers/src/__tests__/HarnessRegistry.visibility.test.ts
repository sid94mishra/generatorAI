// ────────────────────────────────────────────────────────────────
// HarnessRegistry — D-131 server-level provider visibility and catalog
// invalidation. A hidden provider is not probed, not listed, offers no model
// and cannot be brought up; revealing it makes it probe-able again. An
// explicit refresh (and `invalidate`) bypasses a provider's own catalog cache.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import { HarnessRegistry, ProviderHiddenError } from '../HarnessRegistry.js';
import type { HarnessProviderConfig, HarnessType } from '../types.js';
import type { IAgentHarness } from '@generatorai/core';

const invalidated: HarnessType[] = [];
const probes: HarnessType[] = [];

vi.mock('../HarnessFactory.js', () => ({
  createHarnessProvider: vi.fn(async (config: HarnessProviderConfig) => stubFor(config.type)),
}));

function stubFor(type: HarnessType): IAgentHarness {
  return {
    initialize: async () => { /* nothing to start */ },
    getModels: async () => {
      probes.push(type);
      return [{ id: `${type}-model`, name: `${type} model`, provider: type }];
    },
    getAccountInfo: async () => ({ email: 'someone@example.com' }),
    invalidateModelCache: () => { invalidated.push(type); },
    shutdown: async () => { /* nothing to stop */ },
    capabilities: () => ({ mcpServers: true, skills: 'plugin', approvalGating: 'per_call', hostTools: 'full' }),
  } as unknown as IAgentHarness;
}

function registry(): HarnessRegistry {
  return new HarnessRegistry({
    primary: 'claude-agent',
    buildConfig: (type) => (type === 'codex' ? { type, codex: { binaryPath: '/usr/bin/codex' } } : { type }),
  });
}

describe('HarnessRegistry — hidden providers (D-131)', () => {
  it('a hidden provider is absent from statuses and models, unconfigurable, and cannot be brought up', async () => {
    const r = registry();
    r.setHiddenTypes(['codex']);
    await r.refresh(true);
    expect(r.getStatuses().map((s) => s.type)).not.toContain('codex');
    expect((await r.getAllModels()).map((m) => m.provider)).not.toContain('codex');
    expect(r.isConfigurable('codex')).toBe(false);
    expect(r.readyTypes).not.toContain('codex');
    expect(await r.resolveProviderForModel('codex-model')).toBeNull();
    expect(r.statusSnapshot.codex).toMatchObject({ ready: false, models: [] });
    await expect(r.get('codex')).rejects.toBeInstanceOf(ProviderHiddenError);
  });

  it('revealing a provider makes it probe-able and listed again', async () => {
    const r = registry();
    r.setHiddenTypes(['codex']);
    await r.refresh(true);
    r.setHiddenTypes([]);
    await r.refresh(false);
    expect(r.getStatuses().find((s) => s.type === 'codex')).toMatchObject({ ready: true });
    expect((await r.getAllModels()).map((m) => m.id)).toContain('codex-model');
  });

  it('hiding a running provider shuts its adapter down', async () => {
    const r = registry();
    await r.refresh(true);
    const adapter = r.peek('codex');
    expect(adapter).not.toBeNull();
    const shutdown = vi.spyOn(adapter!, 'shutdown');
    r.setHiddenTypes(['codex']);
    expect(shutdown).toHaveBeenCalled();
    expect(r.peek('codex')).toBeNull();
  });

  it('notifies status watchers when visibility changes', async () => {
    const r = registry();
    await r.refresh(true);
    const seen: string[][] = [];
    const stop = r.watchStatus((statuses) => seen.push(statuses.map((s) => s.type)));
    r.setHiddenTypes(['copilot']);
    stop();
    expect(seen.at(-1)).not.toContain('copilot');
  });
});

describe('HarnessRegistry — catalog invalidation', () => {
  it('a forced refresh drops each provider-side catalog cache before asking', async () => {
    invalidated.length = 0;
    const r = registry();
    await r.refresh(true);
    expect(invalidated.sort()).toEqual(['claude-agent', 'codex', 'copilot']);
  });

  it('invalidate(type) makes only that provider stale and re-probed', async () => {
    const r = registry();
    await r.refresh(true);
    probes.length = 0;
    r.invalidate('codex');
    await r.refresh(false);
    expect(probes).toEqual(['codex']);
  });
});

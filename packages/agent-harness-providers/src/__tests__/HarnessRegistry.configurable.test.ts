// ────────────────────────────────────────────────────────────────
// HarnessRegistry — W48 provider honesty:
//   isConfigurable() / configurableTypes — codex/opencode/acp are listed
//   in ALL_HARNESS_TYPES but must not be reported as selectable unless the
//   caller's buildConfig actually supplies their provider section.
//   #logDroppedCapabilities — a configured breadth adapter (codex/opencode/
//   acp) logs exactly which capabilities it drops instead of dropping them
//   silently.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import { HarnessRegistry } from '../HarnessRegistry.js';
import type { HarnessType, HarnessProviderConfig } from '../types.js';
import type { IAgentHarness, ProviderCapabilities } from '@generatorai/core';

vi.mock('../HarnessFactory.js', () => ({
  createHarnessProvider: vi.fn(async (config: HarnessProviderConfig) => stubFor(config.type)),
}));

const FULL_CAPS: ProviderCapabilities = {
  vision: true, reasoning: true, reasoningEfforts: [], planMode: true,
  mcpServers: true, approvalGating: 'per_call', hostTools: 'full', structuredOutput: 'native', skills: 'plugin',
  sessionPersistence: true, budgetTracking: true, computerUse: true,
};

function stubFor(type: HarnessType): IAgentHarness {
  const caps: ProviderCapabilities = type === 'codex'
    ? { ...FULL_CAPS, skills: 'directories', mcpServers: true, approvalGating: 'exec_and_patch', hostTools: 'start_only' }
    : FULL_CAPS;
  return {
    initialize: async () => { /* nothing to start */ },
    getModels: async () => [],
    shutdown: async () => { /* nothing to stop */ },
    capabilities: () => caps,
  } as unknown as IAgentHarness;
}

describe('HarnessRegistry — isConfigurable / configurableTypes', () => {
  it('the two managed providers are always configurable', () => {
    const registry = new HarnessRegistry({ primary: 'copilot', buildConfig: (type) => ({ type }) });
    expect(registry.isConfigurable('copilot')).toBe(true);
    expect(registry.isConfigurable('claude-agent')).toBe(true);
  });

  it('codex/opencode/acp are NOT configurable when buildConfig supplies no section for them', () => {
    const registry = new HarnessRegistry({ primary: 'copilot', buildConfig: (type) => ({ type }) });
    expect(registry.isConfigurable('codex')).toBe(false);
    expect(registry.isConfigurable('opencode')).toBe(false);
    expect(registry.isConfigurable('acp')).toBe(false);
    expect(registry.configurableTypes.sort()).toEqual(['claude-agent', 'copilot']);
  });

  it('a breadth provider becomes configurable once buildConfig supplies its section', () => {
    const registry = new HarnessRegistry({
      primary: 'copilot',
      buildConfig: (type) => (type === 'codex' ? { type, codex: { binaryPath: '/usr/bin/codex' } } : { type }),
    });
    expect(registry.isConfigurable('codex')).toBe(true);
    expect(registry.isConfigurable('opencode')).toBe(false);
    expect(registry.configurableTypes.sort()).toEqual(['claude-agent', 'codex', 'copilot']);
  });

  it('a throwing buildConfig is treated as "not configurable" rather than crashing the check', () => {
    const registry = new HarnessRegistry({
      primary: 'copilot',
      buildConfig: (type) => { if (type === 'acp') throw new Error('no acp binary configured'); return { type }; },
    });
    expect(registry.isConfigurable('acp')).toBe(false);
  });
});

describe('HarnessRegistry — capability-drop logging (W48)', () => {
  it('logs which capabilities a configured breadth provider drops, once brought up', async () => {
    const warn = vi.fn();
    const registry = new HarnessRegistry({
      primary: 'copilot',
      buildConfig: (type) => (type === 'codex' ? { type, codex: { binaryPath: '/usr/bin/codex' } } : { type }),
      logger: { info: vi.fn(), warn },
    });

    await registry.get('codex');

    const call = warn.mock.calls.find(([msg]) => typeof msg === 'string' && msg.includes("'codex' is configured but its adapter drops"));
    expect(call).toBeDefined();
    const message = call![0] as string;
    // approvalGating 'exec_and_patch' on the stub → the permissions drop must be named.
    expect(message).toContain('permissions');
    // Not modelled by ProviderCapabilities at all — must still be named.
    expect(message).toContain('hooks');
  });

  it('does NOT log a capability warning for the two managed providers', async () => {
    const warn = vi.fn();
    const registry = new HarnessRegistry({
      primary: 'copilot',
      buildConfig: (type) => ({ type }),
      logger: { info: vi.fn(), warn },
    });

    await registry.get('copilot');

    expect(warn.mock.calls.some(([msg]) => typeof msg === 'string' && msg.includes('is configured but its adapter drops'))).toBe(false);
  });
});

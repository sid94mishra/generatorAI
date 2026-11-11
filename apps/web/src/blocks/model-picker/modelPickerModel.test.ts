import { describe, expect, it } from 'vitest';
import { buildModelPickerCatalog } from '@generatorai/client-core';
import type { HarnessProviderStatus, HarnessSubProviderStatus } from '@generatorai/shared';
import { initialProvider, searchProvider } from './modelPickerModel.js';

const provider = (type: string, patch: Partial<HarnessProviderStatus>): HarnessProviderStatus => ({
  type,
  label: type,
  installed: true,
  connected: true,
  authenticated: true,
  ready: true,
  modelCount: patch.models?.length ?? 0,
  models: [],
  supportsLogin: false,
  ...patch,
});

const agent = (id: string, ready = true): HarnessSubProviderStatus => ({
  id,
  label: id,
  installed: true,
  connected: true,
  authState: ready ? 'authenticated' : 'unauthenticated',
  authenticated: ready,
  ready,
  modelCount: ready ? 1 : 0,
});

const catalog = buildModelPickerCatalog({
  primary: 'claude-agent',
  stale: false,
  providers: [
    provider('claude-agent', { models: [{ id: 'opus', provider: 'claude-agent', name: 'Opus 5.5' }] }),
    provider('codex', { models: [{ id: 'gpt-5.6-terra', provider: 'codex', name: 'GPT-5.6-Terra' }] }),
    provider('acp', {
      subProviders: [agent('goose', false), agent('gemini'), agent('kimi')],
      models: [
        { id: 'gemini/pro', provider: 'acp', subProvider: 'gemini', name: 'Gemini Pro' },
        { id: 'kimi', provider: 'acp', subProvider: 'kimi', name: 'Kimi' },
      ],
    }),
  ],
});

describe('initialProvider (U-2)', () => {
  it("opens on the selected model's provider, else the default", () => {
    expect(initialProvider(catalog, 'gpt-5.6-terra')).toBe('codex');
    expect(initialProvider(catalog, '')).toBe('claude-agent');
  });

  it('a provider chosen beside the picker wins — even over a model of another provider', () => {
    expect(initialProvider(catalog, '', 'codex')).toBe('codex');
    expect(initialProvider(catalog, 'opus', 'codex')).toBe('codex');
    expect(initialProvider(catalog, 'opus', 'not-installed')).toBe('claude-agent');
  });

  it("opens an ACP model on its agent's entry; a chosen acp provider opens the first ready agent (ACP-3)", () => {
    expect(initialProvider(catalog, 'kimi')).toBe('acp:kimi');
    expect(initialProvider(catalog, 'kimi', 'acp')).toBe('acp:kimi');
    expect(initialProvider(catalog, 'opus', 'acp')).toBe('acp:gemini');
  });
});

describe('searchProvider', () => {
  it('moves to the first ready entry that matches, by key', () => {
    expect(searchProvider(catalog, 'claude-agent', 'kimi')).toBe('acp:kimi');
    expect(searchProvider(catalog, 'acp:gemini', 'pro')).toBe('acp:gemini');
  });
});

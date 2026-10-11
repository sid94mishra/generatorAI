import { describe, expect, it } from 'vitest';
import type { ModelPickerCatalog } from '@generatorai/client-core';
import { initialProvider } from './modelPickerModel.js';

const catalog = {
  defaultProvider: 'claude-agent',
  models: [
    { id: 'opus', provider: 'claude-agent', name: 'Opus 5.5' },
    { id: 'gpt-5.6-terra', provider: 'codex', name: 'GPT-5.6-Terra' },
  ],
  providers: [
    { type: 'claude-agent', models: [{ id: 'opus', provider: 'claude-agent', name: 'Opus 5.5' }] },
    { type: 'codex', models: [{ id: 'gpt-5.6-terra', provider: 'codex', name: 'GPT-5.6-Terra' }] },
  ],
} as unknown as ModelPickerCatalog;

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
});

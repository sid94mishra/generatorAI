import { describe, expect, it } from 'vitest';
import { buildModelPickerCatalog } from '@generatorai/client-core';
import type { HarnessProviderStatus } from '@generatorai/shared';
import { contextLabel, modelSections } from './modelPickerModel';

const provider = (type: string, models: HarnessProviderStatus['models'], ready = true): HarnessProviderStatus => ({
  type,
  label: type.toUpperCase(),
  installed: true,
  connected: true,
  authenticated: ready,
  ready,
  modelCount: models.length,
  models,
  supportsLogin: false,
});

const catalog = buildModelPickerCatalog({
  primary: 'claude-agent',
  stale: false,
  providers: [
    provider('claude-agent', [
      { id: 'opus', name: 'Opus 5.5', isDefault: true },
      { id: 'haiku', name: 'Haiku 4.5' },
      { id: 'sonnet-1m', name: 'Sonnet', promptTokenLimit: 200_000, longContext: { promptTokenLimit: 1_000_000 } },
    ]),
    provider('codex', [{ id: 'gpt-6-luna', name: 'GPT-6-Luna', isDefault: true }]),
    provider('copilot', [{ id: 'x', name: 'X' }], false),
  ],
});

describe('ModelPicker (MB-03, D-131)', () => {
  it("one plain section per ready provider, in the provider's own order — no tier sections", () => {
    const sections = modelSections(catalog);
    expect(sections.map((s) => s.title)).toEqual(['CLAUDE-AGENT', 'CODEX']);
    expect(sections[0]!.models.map((m) => m.id)).toEqual(['opus', 'haiku', 'sonnet-1m']);
    expect(sections[0]!.models[0]!.isDefault).toBe(true);
  });

  it('filters by provider and query; labels context only when reported', () => {
    expect(modelSections(catalog, { provider: 'codex' }).map((s) => s.models.map((m) => m.id))).toEqual([['gpt-6-luna']]);
    expect(modelSections(catalog, { query: 'hai' }).flatMap((s) => s.models.map((m) => m.id))).toEqual(['haiku']);
    const sonnet = catalog.models.find((m) => m.id === 'sonnet-1m')!;
    expect(contextLabel(sonnet)).toBe('200K · 1M');
    expect(contextLabel(catalog.models.find((m) => m.id === 'opus')!)).toBeNull();
  });
});

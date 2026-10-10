// G-09 / D-131 — the model picker's read model. Pinned: ready providers first
// (the configured default first among them), never a default that is not
// ready, a plain model list, detail rows built only from fields the provider
// returned, and a flat ready-only list.

import { describe, expect, it } from 'vitest';
import type { HarnessProviderStatus, HarnessProvidersResponse } from '@generatorai/shared';
import {
  buildModelPickerCatalog,
  findPickerModel,
  modelDetails,
  modelReasoningEfforts,
  providerAvailability,
  readyCatalogModels,
  toPickerModel,
} from '../models/index.js';

function provider(type: string, patch: Partial<HarnessProviderStatus> = {}): HarnessProviderStatus {
  return {
    type,
    label: type.toUpperCase(),
    installed: true,
    connected: true,
    authenticated: true,
    ready: true,
    modelCount: 1,
    models: [{ id: `${type}-m1`, name: `${type} one` }],
    supportsLogin: false,
    ...patch,
  };
}

const signedOut = (type: string) =>
  provider(type, { ready: false, authenticated: false, models: [], modelCount: 0, supportsLogin: true });

function response(primary: string, providers: HarnessProviderStatus[], stale = false): HarnessProvidersResponse {
  return { primary, stale, providers };
}

describe('buildModelPickerCatalog', () => {
  it('never defaults to the configured provider when it is not ready (the cross-platform lesson)', () => {
    const catalog = buildModelPickerCatalog(response('copilot', [signedOut('copilot'), provider('claude-agent')]));
    expect(catalog.defaultProvider).toBe('claude-agent');
    expect(catalog.providers.map((p) => [p.type, p.availability])).toEqual([
      ['claude-agent', 'ready'],
      ['copilot', 'signed_out'],
    ]);
    // A signed-out provider offers no models, even if the wire had some.
    expect(catalog.providers[1]!.models).toEqual([]);
    expect(catalog.providers[1]!.supportsLogin).toBe(true);
  });

  it('puts the configured provider first while it is ready, others keep server order', () => {
    const catalog = buildModelPickerCatalog(
      response('codex', [provider('copilot'), signedOut('opencode'), provider('claude-agent'), provider('codex')]),
    );
    expect(catalog.providers.map((p) => p.type)).toEqual(['codex', 'copilot', 'claude-agent', 'opencode']);
    expect(catalog.defaultProvider).toBe('codex');
    expect(catalog.providers[0]!.primary).toBe(true);
    expect(catalog.models.map((m) => m.id)).toEqual(['codex-m1', 'copilot-m1', 'claude-agent-m1']);
  });

  it('has no default when nothing is ready, and says why each provider is out', () => {
    const catalog = buildModelPickerCatalog(
      response('copilot', [
        provider('copilot', { installed: false, authenticated: false, ready: false, models: [] }),
        signedOut('claude-agent'),
        provider('codex', { ready: false, error: 'CLI crashed' }),
      ]),
    );
    expect(catalog.defaultProvider).toBeNull();
    expect(catalog.providers.map((p) => p.availability)).toEqual(['not_installed', 'signed_out', 'unavailable']);
    expect(catalog.providers[2]!.error).toBe('CLI crashed');
    expect(catalog.models).toEqual([]);
  });

  it('passes the stale flag through so the caller keeps polling', () => {
    expect(buildModelPickerCatalog(response('copilot', [provider('copilot')], true)).stale).toBe(true);
  });

  it('finds a model by id, disambiguated by provider', () => {
    const catalog = buildModelPickerCatalog(
      response('a', [
        provider('a', { models: [{ id: 'same', name: 'A' }] }),
        provider('b', { models: [{ id: 'same', name: 'B' }] }),
      ]),
    );
    expect(findPickerModel(catalog, 'same')?.name).toBe('A');
    expect(findPickerModel(catalog, 'same', 'b')?.name).toBe('B');
    expect(findPickerModel(catalog, null)).toBeUndefined();
  });
});

describe('toPickerModel', () => {
  it('maps the wire fields, keeping the provider default flag', () => {
    const m = toPickerModel(
      {
        id: 'opus',
        name: 'Opus 5.5',
        description: '  For complex work  ',
        isDefault: true,
        promptTokenLimit: 200_000,
        supportsLongContext: true,
        longContext: { promptTokenLimit: 1_000_000 },
        maxOutputTokens: 64_000,
        supportsReasoning: true,
        reasoningEfforts: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'medium',
      },
      'claude-agent',
    );
    expect(m).toMatchObject({
      provider: 'claude-agent',
      description: 'For complex work',
      isDefault: true,
      contextTokens: 200_000,
      longContextTokens: 1_000_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium',
    });
  });

  it('leaves unknowns empty instead of inventing values', () => {
    const m = toPickerModel({ id: 'x', name: '', description: ' ', maxOutputTokens: 0 }, 'p');
    expect(m).toMatchObject({
      name: 'x',
      description: null,
      isDefault: false,
      contextTokens: null,
      longContextTokens: null,
      maxOutputTokens: null,
      reasoningEfforts: [],
      defaultReasoningEffort: null,
    });
  });

  it('falls back to the deprecated context fields and drops a default effort the model does not list', () => {
    const m = toPickerModel(
      { id: 'y', name: 'Y', contextWindow: 128_000, supportsReasoning: true, reasoningEfforts: ['high'], defaultReasoningEffort: 'low' },
      'p',
    );
    expect(m.contextTokens).toBe(128_000);
    expect(m.defaultReasoningEffort).toBeNull();
  });
});

describe('modelDetails (only what the provider returned)', () => {
  it('Codex model/list row: efforts, default effort, input modalities — and nothing about context', () => {
    const m = toPickerModel(
      {
        id: 'gpt-6-luna',
        name: 'GPT-6-Luna',
        provider: 'codex',
        description: 'Fast and affordable model for easier tasks.',
        isDefault: true,
        supportsReasoning: true,
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultReasoningEffort: 'medium',
        inputModalities: ['text', 'image'],
        supportsVision: true,
      },
      'codex',
    );
    expect(modelDetails(m)).toEqual([
      { label: 'Reasoning', value: 'low, medium, high, xhigh, max' },
      { label: 'Default effort', value: 'medium' },
      { label: 'Input', value: 'text, image' },
    ]);
  });

  it('Claude supportedModels row: resolved id and capability flags', () => {
    const m = toPickerModel(
      {
        id: 'opus',
        name: 'Opus 5.5',
        resolvedModel: 'claude-opus-5-5',
        features: ['Adaptive thinking', 'Fast mode'],
        supportsReasoning: true,
        reasoningEfforts: ['low', 'max'],
      },
      'claude-agent',
    );
    expect(modelDetails(m)).toEqual([
      { label: 'Resolves to', value: 'claude-opus-5-5', mono: true },
      { label: 'Reasoning', value: 'low, max' },
      { label: 'Features', value: 'Adaptive thinking, Fast mode' },
    ]);
  });

  it('Copilot listModels row: limits, vision, picker category, billing', () => {
    const m = toPickerModel(
      {
        id: 'gpt-x',
        name: 'GPT X',
        promptTokenLimit: 128_000,
        totalContextWindow: 192_000,
        maxOutputTokens: 64_000,
        supportsVision: false,
        category: 'versatile',
        billingMultiplier: 1,
        pricing: { input: 1, output: 4, batchSize: 1_000_000 },
      },
      'copilot',
    );
    expect(modelDetails(m)).toEqual([
      { label: 'Context (prompt)', value: '128K', mono: true },
      { label: 'Context (total)', value: '192K', mono: true },
      { label: 'Max output', value: '64K', mono: true },
      { label: 'Vision', value: 'Not supported' },
      { label: 'Category', value: 'versatile' },
      { label: 'Billing', value: '1×', mono: true },
      { label: 'AI credits', value: 'in 1 · out 4 per 1M tokens', mono: true },
    ]);
  });

  it('a model with nothing but a name has no detail rows', () => {
    expect(modelDetails(toPickerModel({ id: 'bare', name: 'Bare' }, 'p'))).toEqual([]);
  });
});

describe('helpers', () => {
  it('modelReasoningEfforts: only for reasoning models; accepts the older string shape', () => {
    expect(modelReasoningEfforts({ supportsReasoning: false, reasoningEfforts: ['low'] })).toEqual([]);
    expect(modelReasoningEfforts({ supportsReasoning: true, reasoningEfforts: 'low  high' })).toEqual(['low', 'high']);
  });

  it('providerAvailability ranks installed → authenticated → ready', () => {
    expect(providerAvailability(provider('a'))).toBe('ready');
    expect(providerAvailability(signedOut('a'))).toBe('signed_out');
  });

  it('readyCatalogModels: ready providers only, configured default first, provider-tagged', () => {
    const flat = readyCatalogModels(
      response('codex', [provider('copilot'), signedOut('claude-agent'), provider('codex')]),
    );
    expect(flat.map((m) => [m.id, m.provider])).toEqual([
      ['codex-m1', 'codex'],
      ['copilot-m1', 'copilot'],
    ]);
  });
});

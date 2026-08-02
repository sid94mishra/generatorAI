import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '@generatorai/client-core';

import { findModel, groupModels, promptLimit, reasoningEfforts } from '../api/modelCatalogue';

function model(partial: Partial<ModelInfo>): ModelInfo {
  return { id: 'm', name: 'M', ...partial };
}

describe('reasoningEfforts', () => {
  it('accepts the array the server actually sends', () => {
    // The wrong assumption here (a space-separated string) threw
    // `.trim is not a function` and blanked the entire app.
    expect(
      reasoningEfforts(
        model({ supportsReasoning: true, reasoningEfforts: ['low', 'medium', 'high'] }),
      ),
    ).toEqual(['low', 'medium', 'high']);
  });

  it('still accepts a space-separated string', () => {
    expect(
      reasoningEfforts(model({ supportsReasoning: true, reasoningEfforts: 'low  high' })),
    ).toEqual(['low', 'high']);
  });

  it('offers nothing when the model does not reason', () => {
    expect(
      reasoningEfforts(model({ supportsReasoning: false, reasoningEfforts: ['low'] })),
    ).toEqual([]);
  });

  it('offers nothing when the field is missing', () => {
    expect(reasoningEfforts(model({ supportsReasoning: true }))).toEqual([]);
  });

  it('is safe for an undefined model', () => {
    expect(reasoningEfforts(undefined)).toEqual([]);
  });

  it('drops non-string entries rather than rendering them', () => {
    expect(
      reasoningEfforts(
        model({ supportsReasoning: true, reasoningEfforts: ['low', '', null as never] }),
      ),
    ).toEqual(['low']);
  });
});

describe('promptLimit', () => {
  it('prefers the prompt limit over the context window', () => {
    // The gauge denominator is what fits in the PROMPT, which is smaller than
    // the total window on every provider that distinguishes them.
    expect(promptLimit(model({ promptTokenLimit: 200_000, contextWindow: 264_000 }))).toBe(200_000);
  });

  it('falls back through contextWindow then totalContextWindow', () => {
    expect(promptLimit(model({ contextWindow: 128_000 }))).toBe(128_000);
    expect(promptLimit(model({ totalContextWindow: 1_000_000 }))).toBe(1_000_000);
  });

  it('returns null when the model reports no window at all', () => {
    // Null, not zero: the caller hides the gauge rather than dividing by it.
    expect(promptLimit(model({}))).toBeNull();
  });
});

describe('findModel', () => {
  const catalogue = [model({ id: 'a' }), model({ id: 'b' })];

  it('finds by id', () => {
    expect(findModel(catalogue, 'b')?.id).toBe('b');
  });

  it('is undefined for a model that left the catalogue', () => {
    expect(findModel(catalogue, 'gone')).toBeUndefined();
  });

  it('is undefined for a null selection', () => {
    expect(findModel(catalogue, null)).toBeUndefined();
  });
});

describe('groupModels', () => {
  it('labels known providers and preserves catalogue order within a group', () => {
    const groups = groupModels([
      model({ id: 'a', provider: 'copilot' }),
      model({ id: 'x', provider: 'claude-agent' }),
      model({ id: 'b', provider: 'copilot' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['GitHub Copilot', 'Claude Code']);
    expect(groups[0]!.models.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('buckets a model with no provider rather than dropping it', () => {
    const groups = groupModels([model({ id: 'a' })]);
    expect(groups).toEqual([{ provider: 'other', label: 'other', models: [expect.anything()] }]);
  });

  it('is empty for no catalogue', () => {
    expect(groupModels(undefined)).toEqual([]);
  });
});

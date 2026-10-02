import { describe, expect, it } from 'vitest';
import type { PickerModel } from '@generatorai/client-core';
import { contextLabel, modelSections } from './modelPickerModel';

const m = (id: string, tier: PickerModel['tier'], provider = 'claude'): PickerModel =>
  ({ id, name: id, provider, tier, description: null, contextTokens: 200_000, longContextTokens: id.includes('1m') ? 1_000_000 : null, maxOutputTokens: null, vision: false, reasoningEfforts: [], defaultReasoningEffort: null, source: {} }) as unknown as PickerModel;

describe('ModelPicker (MB-03)', () => {
  it('sections by tier in Fast → Balanced → Powerful order, then the rest', () => {
    const sections = modelSections([m('opus', 'powerful'), m('haiku', 'lightweight'), m('custom', null), m('sonnet-1m', 'versatile')]);
    expect(sections.map((s) => s.title)).toEqual(['Fast', 'Balanced', 'Powerful', 'Other']);
  });

  it('filters by provider and query; labels both context tiers', () => {
    expect(modelSections([m('a', 'powerful', 'x'), m('b', 'powerful', 'y')], { provider: 'y' })[0]!.models.map((x) => x.id)).toEqual(['b']);
    expect(modelSections([m('opus', 'powerful'), m('haiku', 'lightweight')], { query: 'hai' }).map((s) => s.title)).toEqual(['Fast']);
    expect(contextLabel(m('sonnet-1m', 'versatile'))).toBe('200K · 1M');
  });
});

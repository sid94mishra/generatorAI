// MB-03 ModelPicker model (pure): the catalogue's models as tier sections (Fast / Balanced / Powerful, MD-49
// single choice), filtered to one provider and by a search query; "200K · 1M" context labels.
import { formatTokenLimit, type PickerModel } from '@generatorai/client-core';
import { MODEL_TIERS, MODEL_TIER_LABELS, type ModelTier } from '@generatorai/shared';

export interface ModelSection {
  title: string;
  models: PickerModel[];
}

export function contextLabel(model: Pick<PickerModel, 'contextTokens' | 'longContextTokens'>): string | null {
  const parts = [model.contextTokens, model.longContextTokens].filter((n): n is number => typeof n === 'number').map(formatTokenLimit);
  return parts.length ? parts.join(' · ') : null;
}

export function modelSections(models: readonly PickerModel[], options: { provider?: string | null; query?: string } = {}): ModelSection[] {
  const q = options.query?.trim().toLowerCase() ?? '';
  const list = models.filter((m) => (!options.provider || m.provider === options.provider) && (!q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)));
  const byTier = new Map<ModelTier | 'other', PickerModel[]>();
  for (const m of list) {
    const key = m.tier ?? 'other';
    byTier.set(key, [...(byTier.get(key) ?? []), m]);
  }
  const sections: ModelSection[] = MODEL_TIERS.filter((t) => byTier.has(t)).map((t) => ({ title: MODEL_TIER_LABELS[t], models: byTier.get(t)! }));
  if (byTier.has('other')) sections.push({ title: sections.length ? 'Other' : 'Models', models: byTier.get('other')! });
  return sections;
}

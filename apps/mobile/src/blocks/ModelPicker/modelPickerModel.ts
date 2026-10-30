// MB-03 ModelPicker model (pure): the catalogue's real models as plain lists (D-131 — no tier sections), one
// section per provider in the catalogue's order (just the one when a provider is chosen), filtered by a search
// query; "200K · 1M" context labels only when the provider reported them.
import { formatTokenLimit, type ModelPickerCatalog, type PickerModel } from '@generatorai/client-core';

export interface ModelSection {
  /** Provider id of the section's models. */
  provider: string;
  title: string;
  models: PickerModel[];
}

export function contextLabel(model: Pick<PickerModel, 'contextTokens' | 'longContextTokens'>): string | null {
  const parts = [model.contextTokens, model.longContextTokens].filter((n): n is number => typeof n === 'number').map(formatTokenLimit);
  return parts.length ? parts.join(' · ') : null;
}

export function modelSections(catalog: Pick<ModelPickerCatalog, 'providers'>, options: { provider?: string | null; query?: string } = {}): ModelSection[] {
  const q = options.query?.trim().toLowerCase() ?? '';
  return catalog.providers
    .filter((p) => p.availability === 'ready' && (!options.provider || p.type === options.provider))
    .map((p) => ({
      provider: p.type,
      title: p.label,
      models: p.models.filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)),
    }))
    .filter((s) => s.models.length > 0);
}

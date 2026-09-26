// ────────────────────────────────────────────────────────────────
// B-01 ModelPicker — pure helpers over client-core's picker read model
// (`buildModelPickerCatalog`): which provider to open on, tier groups,
// search, the row's context text and the provider-readiness copy.
// React-free so the view, the connected block and the tests share them.
// ────────────────────────────────────────────────────────────────

import {
  findPickerModel,
  formatTokenLimit,
  type ModelPickerCatalog,
  type PickerModel,
  type PickerProvider,
  type ProviderAvailability,
} from '@generatorai/client-core';
import { MODEL_TIERS, MODEL_TIER_LABELS } from '@generatorai/shared';

/** Short status under a provider's name in the provider column. */
export const AVAILABILITY_LABEL: Record<ProviderAvailability, string> = {
  ready: 'Ready',
  signed_out: 'Not signed in',
  not_installed: 'Not installed',
  unavailable: 'Unavailable',
};

/** What to do about a provider that is not ready (not installed and sign-in read differently). */
export const AVAILABILITY_HINT: Record<Exclude<ProviderAvailability, 'ready'>, string> = {
  signed_out: 'Sign in to this provider to use its models, then refresh the list.',
  not_installed: "Install this provider's CLI on the server, then refresh the list.",
  unavailable: 'This provider did not answer. Check it in Settings, then refresh the list.',
};

/**
 * The provider the picker opens on: the selected model's provider, else the
 * catalog's `defaultProvider` (never one that is not ready), else the first
 * provider so its reason is on screen. Null when the catalog has none.
 */
export function initialProvider(catalog: ModelPickerCatalog | undefined, value: string): string | null {
  if (!catalog) return null;
  return findPickerModel(catalog, value)?.provider ?? catalog.defaultProvider ?? catalog.providers[0]?.type ?? null;
}

export interface ModelGroup {
  key: string;
  /** Null for the single ungrouped list (no model of the provider carries a tier). */
  label: string | null;
  models: PickerModel[];
}

/** Fast / Balanced / Powerful when the provider gives tiers; otherwise one ungrouped list. */
export function groupModels(models: readonly PickerModel[]): ModelGroup[] {
  if (!models.some((m) => m.tier)) return models.length ? [{ key: 'all', label: null, models: [...models] }] : [];
  const groups: ModelGroup[] = MODEL_TIERS.map((tier) => ({
    key: tier,
    label: MODEL_TIER_LABELS[tier],
    models: models.filter((m) => m.tier === tier),
  }));
  groups.push({ key: 'other', label: 'Other', models: models.filter((m) => !m.tier) });
  return groups.filter((g) => g.models.length > 0);
}

/** Case-insensitive match on the model's name or id. */
export function filterModels(models: readonly PickerModel[], query: string): PickerModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...models];
  return models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
}

/** "200K · 1M" — the default prompt budget, then the long-context one when the model has it. */
export function contextSummary(model: PickerModel): string | null {
  const parts = [model.contextTokens, model.longContextTokens].filter((n): n is number => n != null);
  return parts.length ? parts.map(formatTokenLimit).join(' · ') : null;
}

/** The field trigger's secondary text: "Balanced · 200K · Claude Code". */
export function modelMeta(model: PickerModel, provider: PickerProvider | undefined): string {
  return [
    model.tier ? MODEL_TIER_LABELS[model.tier] : null,
    model.contextTokens != null ? formatTokenLimit(model.contextTokens) : null,
    provider?.label ?? model.provider,
  ]
    .filter(Boolean)
    .join(' · ');
}

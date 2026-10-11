// ────────────────────────────────────────────────────────────────
// B-01 ModelPicker — pure helpers over client-core's picker read model
// (`buildModelPickerCatalog`): which provider to open on, search, the row's
// context text and the provider-readiness copy. Models are one plain list in
// the provider's own order (D-131: no tier groups).
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
export function initialProvider(catalog: ModelPickerCatalog | undefined, value: string, preferred?: string): string | null {
  if (!catalog) return null;
  // A provider chosen next to the picker (an agent's Provider field) decides
  // which list opens: its models are the only ones that make sense there.
  if (preferred && catalog.providers.some((p) => p.type === preferred)) return preferred;
  return findPickerModel(catalog, value)?.provider ?? catalog.defaultProvider ?? catalog.providers[0]?.type ?? null;
}

/** Case-insensitive match on the model's name or id. */
export function filterModels(models: readonly PickerModel[], query: string): PickerModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...models];
  return models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
}

/**
 * The provider whose models a search shows: the browsed one while it has a
 * match (or nothing is typed), else the first ready provider that matches —
 * typing "terra" with Claude Code open finds Codex's GPT-5.6-Terra instead of
 * "No models match". Falls back to the browsed provider when nothing matches.
 */
export function searchProvider(catalog: ModelPickerCatalog | undefined, browsed: string | null, query: string): string | null {
  if (!catalog || !query.trim()) return browsed;
  const current = catalog.providers.find((p) => p.type === browsed);
  if (current?.availability === 'ready' && filterModels(current.models, query).length > 0) return browsed;
  const match = catalog.providers.find((p) => p.availability === 'ready' && filterModels(p.models, query).length > 0);
  return match?.type ?? browsed;
}

/** "200K · 1M" — the default prompt budget, then the long-context one when the model has it. */
export function contextSummary(model: PickerModel): string | null {
  const parts = [model.contextTokens, model.longContextTokens].filter((n): n is number => n != null);
  return parts.length ? parts.map(formatTokenLimit).join(' · ') : null;
}

/** The field trigger's secondary text: "200K · Claude Code" (context only when the provider reported one). */
export function modelMeta(model: PickerModel, provider: PickerProvider | undefined): string {
  return [model.contextTokens != null ? formatTokenLimit(model.contextTokens) : null, provider?.label ?? model.provider]
    .filter(Boolean)
    .join(' · ');
}

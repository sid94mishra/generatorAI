// ────────────────────────────────────────────────────────────────
// Model-picker read model (G-09).
//
// Turns `GET /api/harness/providers` into what a model picker draws: the
// provider column (ready providers first, each with why it is not usable
// otherwise), and per model the detail pane's facts (tier, description,
// context, long context, max output, reasoning levels, vision).
//
// The one rule every picker must follow: never land on a provider that is
// not ready. The server's `primary` is its *configured* preference and is
// reported whether or not that provider is signed in; auto-selecting it left
// anyone without, e.g., a Copilot login on a picker that could not start a
// chat — on every OS. `defaultProvider` is `primary` only while it is ready,
// else the first ready provider, else null.
//
// React-free: web wraps it in a hook, mobile and the CLI call it directly.
// ────────────────────────────────────────────────────────────────

import {
  MODEL_TIERS,
  type HarnessCatalogModel,
  type HarnessProviderStatus,
  type HarnessProvidersResponse,
  type ModelTier,
} from '@generatorai/shared';

/** Why a provider can or cannot be used right now. */
export type ProviderAvailability = 'ready' | 'not_installed' | 'signed_out' | 'unavailable';

/** One model as the picker's row and detail pane show it. */
export interface PickerModel {
  id: string;
  name: string;
  provider: string;
  /** `lightweight | versatile | powerful`, or null when the provider gives none. */
  tier: ModelTier | null;
  description: string | null;
  /** Prompt-token limit of the default tier (the context gauge's denominator). */
  contextTokens: number | null;
  /** Prompt-token limit of the long-context tier, when the model has one. */
  longContextTokens: number | null;
  maxOutputTokens: number | null;
  vision: boolean;
  /** Levels the model accepts, in the provider's order; empty = no effort selector. */
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  /** The wire entry, for callers that need a field the picker does not. */
  source: HarnessCatalogModel;
}

/** One entry of the provider column. */
export interface PickerProvider {
  type: string;
  label: string;
  availability: ProviderAvailability;
  /** The server's configured default provider. */
  primary: boolean;
  error: string | null;
  supportsLogin: boolean;
  /** Models to offer — always empty unless `availability === 'ready'`. */
  models: PickerModel[];
}

export interface ModelPickerCatalog {
  /** Ready providers first (the configured default first among them), then the rest in server order. */
  providers: PickerProvider[];
  /** The provider to open on / auto-select: never one that is not ready; null when none is. */
  defaultProvider: string | null;
  /** Every model of every ready provider, in `providers` order. */
  models: PickerModel[];
  /** The server answered from its snapshot and is re-probing; poll until false. */
  stale: boolean;
}

export function providerAvailability(p: HarnessProviderStatus): ProviderAvailability {
  if (p.ready) return 'ready';
  if (!p.installed) return 'not_installed';
  if (!p.authenticated) return 'signed_out';
  return 'unavailable';
}

function positive(n: number | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/** The effort levels a model accepts: only when it reasons; tolerates the older space-separated string. */
export function modelReasoningEfforts(model: Pick<HarnessCatalogModel, 'supportsReasoning'> & {
  reasoningEfforts?: string[] | string;
}): string[] {
  if (!model.supportsReasoning) return [];
  const raw = model.reasoningEfforts;
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === 'string' && v.length > 0);
  if (typeof raw === 'string') return raw.trim().split(/\s+/).filter(Boolean);
  return [];
}

export function toPickerModel(model: HarnessCatalogModel, provider: string): PickerModel {
  const efforts = modelReasoningEfforts(model);
  const tier = (MODEL_TIERS as readonly string[]).includes(model.category ?? '')
    ? (model.category as ModelTier)
    : null;
  const defaultEffort =
    model.defaultReasoningEffort && efforts.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : null;
  return {
    id: model.id,
    name: model.name || model.id,
    provider: model.provider ?? provider,
    tier,
    description: model.description?.trim() ? model.description.trim() : null,
    contextTokens: positive(model.promptTokenLimit ?? model.standardContextWindow ?? model.contextWindow),
    longContextTokens: model.supportsLongContext === false ? null : positive(model.longContext?.promptTokenLimit),
    maxOutputTokens: positive(model.maxOutputTokens),
    vision: model.supportsVision === true,
    reasoningEfforts: efforts,
    defaultReasoningEffort: defaultEffort,
    source: model,
  };
}

/** The picker's view of the provider catalog. */
export function buildModelPickerCatalog(response: HarnessProvidersResponse): ModelPickerCatalog {
  const providers: PickerProvider[] = response.providers.map((p) => {
    const availability = providerAvailability(p);
    return {
      type: p.type,
      label: p.label,
      availability,
      primary: p.type === response.primary,
      error: p.error ?? null,
      supportsLogin: p.supportsLogin === true,
      models: availability === 'ready' ? p.models.map((m) => toPickerModel(m, p.type)) : [],
    };
  });
  const rank = (p: PickerProvider): number => (p.availability === 'ready' ? (p.primary ? 0 : 1) : 2);
  // Array.prototype.sort is stable, so server order is kept within a rank.
  const ordered = [...providers].sort((a, b) => rank(a) - rank(b));
  const first = ordered[0];
  return {
    providers: ordered,
    defaultProvider: first && first.availability === 'ready' ? first.type : null,
    models: ordered.flatMap((p) => p.models),
    stale: response.stale === true,
  };
}

/**
 * Every model of every READY provider, tagged with its provider — the flat list
 * the composer and "start on the first model that can run" use. Same order as
 * the picker: the configured default provider first while it is ready, so
 * `[0]` is never a model of a provider that is not ready.
 */
export function readyCatalogModels(response: HarnessProvidersResponse): HarnessCatalogModel[] {
  const ready = response.providers.filter((p) => p.ready);
  const ordered = [
    ...ready.filter((p) => p.type === response.primary),
    ...ready.filter((p) => p.type !== response.primary),
  ];
  return ordered.flatMap((p) => p.models.map((m) => ({ ...m, provider: m.provider ?? p.type })));
}

/** A model by id (and provider, when two providers serve the same id). */
export function findPickerModel(
  catalog: ModelPickerCatalog,
  id: string | null | undefined,
  provider?: string | null,
): PickerModel | undefined {
  if (!id) return undefined;
  return catalog.models.find((m) => m.id === id && (!provider || m.provider === provider));
}

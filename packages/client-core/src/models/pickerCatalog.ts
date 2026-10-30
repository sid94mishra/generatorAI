// ────────────────────────────────────────────────────────────────
// Model-picker read model (G-09).
//
// Turns `GET /api/harness/providers` into what a model picker draws: the
// provider column (ready providers first, each with why it is not usable
// otherwise), a plain list of each provider's models in the provider's own
// order, and per model the detail rows (`modelDetails`) — built ONLY from
// fields the provider returned (D-131). A field the provider did not send is
// not shown; there are no tiers, no "recommended" entries, no assumed limits.
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

import { REASONING_EFFORTS, type HarnessCatalogModel, type HarnessProviderStatus, type HarnessProvidersResponse } from '@generatorai/shared';
import { formatTokenLimit } from './formatTokenLimit.js';

/** Why a provider can or cannot be used right now. */
export type ProviderAvailability = 'ready' | 'not_installed' | 'signed_out' | 'unavailable';

/** One model as the picker's row and detail pane show it. */
export interface PickerModel {
  id: string;
  name: string;
  provider: string;
  description: string | null;
  /** The provider flags this model as the account default (the row's "default" badge). */
  isDefault: boolean;
  /** Prompt-token limit of the default tier (the context gauge's denominator), when the provider reported one. */
  contextTokens: number | null;
  /** Prompt-token limit of the long-context tier, when the model has one. */
  longContextTokens: number | null;
  maxOutputTokens: number | null;
  /** Levels the model accepts, in the provider's order; empty = no effort selector. */
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  /** The wire entry, for callers that need a field the picker does not. */
  source: HarnessCatalogModel;
}

/** One fact of a model's detail pane / sheet. */
export interface ModelDetail {
  label: string;
  value: string;
  /** Render in the mono face (ids, token counts). */
  mono?: boolean;
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

/**
 * The effort levels an effort selector offers: the chosen model's own levels
 * (the provider's list — empty when it has none), or every level when no
 * model is chosen yet and the effort is inherited from elsewhere.
 */
export function effortChoices(model: HarnessCatalogModel | undefined): string[] {
  return model ? modelReasoningEfforts(model) : [...REASONING_EFFORTS];
}

export function toPickerModel(model: HarnessCatalogModel, provider: string): PickerModel {
  const efforts = modelReasoningEfforts(model);
  const defaultEffort =
    model.defaultReasoningEffort && efforts.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : null;
  return {
    id: model.id,
    name: model.name || model.id,
    provider: model.provider ?? provider,
    description: model.description?.trim() ? model.description.trim() : null,
    isDefault: model.isDefault === true,
    contextTokens: positive(model.promptTokenLimit ?? model.standardContextWindow ?? model.contextWindow),
    longContextTokens: model.supportsLongContext === false ? null : positive(model.longContext?.promptTokenLimit),
    maxOutputTokens: positive(model.maxOutputTokens),
    reasoningEfforts: efforts,
    defaultReasoningEffort: defaultEffort,
    source: model,
  };
}

const list = (items: readonly string[]): string => items.join(', ');

/**
 * The detail rows of a model — hover / focus in the web picker, the info row
 * on mobile. Every row is a field the provider returned; nothing else.
 */
export function modelDetails(model: PickerModel): ModelDetail[] {
  const src = model.source;
  const rows: ModelDetail[] = [];
  if (src.resolvedModel) rows.push({ label: 'Resolves to', value: src.resolvedModel, mono: true });
  if (model.contextTokens != null) rows.push({ label: 'Context (prompt)', value: formatTokenLimit(model.contextTokens), mono: true });
  const total = positive(src.totalContextWindow);
  if (total != null && total !== model.contextTokens) rows.push({ label: 'Context (total)', value: formatTokenLimit(total), mono: true });
  if (model.longContextTokens != null) {
    rows.push({ label: 'Long context (prompt)', value: formatTokenLimit(model.longContextTokens), mono: true });
  }
  if (model.maxOutputTokens != null) rows.push({ label: 'Max output', value: formatTokenLimit(model.maxOutputTokens), mono: true });
  if (model.reasoningEfforts.length > 0) rows.push({ label: 'Reasoning', value: list(model.reasoningEfforts) });
  if (model.defaultReasoningEffort) rows.push({ label: 'Default effort', value: model.defaultReasoningEffort });
  if (src.inputModalities?.length) rows.push({ label: 'Input', value: list(src.inputModalities) });
  else if (typeof src.supportsVision === 'boolean') rows.push({ label: 'Vision', value: src.supportsVision ? 'Supported' : 'Not supported' });
  if (src.features?.length) rows.push({ label: 'Features', value: list(src.features) });
  if (src.category) rows.push({ label: 'Category', value: src.category });
  if (src.priceCategory) rows.push({ label: 'Price tier', value: src.priceCategory });
  if (typeof src.billingMultiplier === 'number') rows.push({ label: 'Billing', value: `${src.billingMultiplier}×`, mono: true });
  const pricing = src.pricing;
  if (pricing && (pricing.input != null || pricing.output != null)) {
    const per = pricing.batchSize ? ` per ${formatTokenLimit(pricing.batchSize)} tokens` : '';
    const parts = [
      pricing.input != null ? `in ${pricing.input}` : null,
      pricing.output != null ? `out ${pricing.output}` : null,
      pricing.cached != null ? `cached ${pricing.cached}` : null,
    ].filter(Boolean);
    // Copilot: AI Credits per billing batch of tokens.
    rows.push({ label: 'AI credits', value: `${parts.join(' · ')}${per}`, mono: true });
  }
  return rows;
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

/**
 * The model a second review runs on after a Codex turn changed code (evaluation: a Sonnet review caught Codex's
 * regressions every time it was asked): the first ready Claude Sonnet, else any ready Claude model.
 */
export function pickReviewModel(models: readonly HarnessCatalogModel[] | undefined): HarnessCatalogModel | undefined {
  const claude = (models ?? []).filter((m) => m.provider === 'claude-agent');
  return claude.find((m) => /sonnet/i.test(m.id)) ?? claude[0];
}

/** A finished turn changed files: a recorded file operation, or a writing tool that completed. */
export function turnChangedFiles(toolCalls: ReadonlyArray<{ tool: string; fileOp?: unknown; success?: boolean }> | undefined): boolean {
  return (toolCalls ?? []).some(
    (c) => !!c.fileOp || (c.success !== false && /^(apply_patch|edit|multiedit|write|notebookedit)$/i.test(c.tool)),
  );
}

/**
 * A model by id (and provider, when two providers serve the same id). A reply records the concrete model it ran on
 * (`claude-opus-5-5`) while the catalog lists the alias (`opus`), so an id that matches no entry falls back to the
 * entry that resolves to it.
 */
export function findPickerModel(
  catalog: ModelPickerCatalog,
  id: string | null | undefined,
  provider?: string | null,
): PickerModel | undefined {
  if (!id) return undefined;
  const served = (m: PickerModel) => !provider || m.provider === provider;
  return catalog.models.find((m) => m.id === id && served(m)) ?? catalog.models.find((m) => m.source.resolvedModel === id && served(m));
}

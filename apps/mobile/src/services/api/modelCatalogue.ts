// ────────────────────────────────────────────────────────────────
// Model catalogue helpers.
//
// Pure, and separate from `useModels` because that module transitively
// imports the auth provider — and therefore `react-native`, whose Flow-typed
// entry point vitest cannot parse. These are the functions with real edge
// cases, so they are the ones that must be testable.
// ────────────────────────────────────────────────────────────────

import { modelReasoningEfforts, type ModelInfo } from '@generatorai/client-core';
import { harnessProviderLabel } from '@generatorai/shared';

/** Models grouped by provider, in stable display order. */
export interface ModelGroup {
  provider: string;
  label: string;
  models: ModelInfo[];
}

/** Groups a flat catalogue by provider for a sectioned picker. */
export function groupModels(models: ModelInfo[] | undefined): ModelGroup[] {
  const byProvider = new Map<string, ModelInfo[]>();
  for (const model of models ?? []) {
    const key = model.provider ?? 'other';
    const bucket = byProvider.get(key);
    if (bucket) bucket.push(model);
    else byProvider.set(key, [model]);
  }
  return [...byProvider.entries()].map(([provider, list]) => ({
    provider,
    label: harnessProviderLabel(provider),
    models: list,
  }));
}

/**
 * The reasoning-effort levels a model accepts.
 *
 * The server sends an ARRAY. This was previously assumed to be a
 * space-separated string, and calling `.trim()` on an array threw
 * `model.reasoningEfforts?.trim is not a function` — an uncaught render error
 * that blanked the ENTIRE app the moment a reasoning-capable model was
 * selected. Both shapes are accepted so neither assumption can crash it
 * again. The field is absent for models that do not reason, in which case
 * the selector must not be offered at all.
 */
export function reasoningEfforts(model: ModelInfo | undefined): string[] {
  return model ? modelReasoningEfforts(model) : [];
}

/**
 * The context-gauge denominator.
 *
 * Prefers the PROMPT limit: on every provider that distinguishes them it is
 * smaller than the total window, and using the larger number would show a
 * comfortable gauge right up to the point the request is rejected.
 */
export function promptLimit(model: ModelInfo | undefined): number | null {
  return model?.promptTokenLimit ?? model?.contextWindow ?? model?.totalContextWindow ?? null;
}

/** Finds a model by id across the catalogue. */
export function findModel(
  models: ModelInfo[] | undefined,
  id: string | null | undefined,
): ModelInfo | undefined {
  if (!id) return undefined;
  return models?.find((m) => m.id === id);
}

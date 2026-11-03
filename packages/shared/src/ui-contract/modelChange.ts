// ────────────────────────────────────────────────────────────────
// modelChange — what a chat runs on once its model is changed
// ────────────────────────────────────────────────────────────────
//
// A model belongs to a provider, and a chat's conversation only moves to
// another provider when its record names that provider (`harnessType`, E-4):
// the router never infers a move from a model name. So the record is settled
// where the model is set — whoever sets it (the web picker, the API, a phone)
// — instead of trusting every client to send the provider along. The effort
// level is settled there too: Claude goes up to `max`, Codex models to
// `xhigh`, and a level the model does not take must not reach its provider.

import { REASONING_EFFORTS } from '../types/ProviderConfig.js';

/** A model as the merged catalog lists it (`IAgentHarness.getModels`). */
export interface CatalogModel {
  id: string;
  provider?: string;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
}

/** "Let the provider pick": spelled differently by each vendor, so it never names one. */
const SENTINELS = new Set(['auto', 'default', 'inherit', '']);

export interface SettledModelChange {
  /** The provider the chat runs on with this model; unset when nothing says. */
  provider?: string;
  /** The effort level to keep; unset when the chat should use the model's default. */
  effort?: string;
}

/**
 * The provider and effort for a chat whose model becomes `model`.
 *
 *   provider  the one the request named; else the chat's current one when it offers the model; else the
 *             (first) provider that offers it; else the current one
 *   effort    kept when the model takes it (or its levels are unknown); else the highest level it takes
 *             below the one asked for; else its default
 */
export function settleModelChange(input: {
  model: string;
  requestedProvider?: string | undefined;
  currentProvider?: string | undefined;
  effort?: string | undefined;
  catalog: readonly CatalogModel[];
}): SettledModelChange {
  const { model, requestedProvider, currentProvider, effort, catalog } = input;
  const offers = catalog.filter((m) => m.id === model);
  const provider =
    requestedProvider ??
    (SENTINELS.has(model.trim().toLowerCase())
      ? currentProvider
      : offers.some((m) => m.provider === currentProvider)
        ? currentProvider
        : (offers[0]?.provider ?? currentProvider));
  const entry = offers.find((m) => m.provider === provider) ?? (provider === undefined ? offers[0] : undefined);
  const levels = entry?.reasoningEfforts ?? [];
  if (!effort || levels.length === 0 || levels.includes(effort)) {
    return { ...(provider ? { provider } : {}), ...(effort ? { effort } : {}) };
  }
  const order: readonly string[] = REASONING_EFFORTS;
  const asked = order.indexOf(effort);
  const below = levels.filter((l) => order.indexOf(l) >= 0 && order.indexOf(l) <= asked).sort((a, b) => order.indexOf(b) - order.indexOf(a));
  const fitted = below[0] ?? entry?.defaultReasoningEffort;
  return { ...(provider ? { provider } : {}), ...(fitted ? { effort: fitted } : {}) };
}

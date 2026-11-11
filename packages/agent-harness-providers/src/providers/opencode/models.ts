// ────────────────────────────────────────────────────────────────
// OpenCode 2 models — `GET /api/model` rows as HarnessModel, and the
// `{ id, providerID, variant? }` reference OpenCode addresses a model by.
//
// Reasoning effort is a model VARIANT in OpenCode 2 (`D/models#variants`):
// the catalog lists each model's variants, and a session selects one with
// `model.variant`. Variants named like an effort level are offered as the
// model's efforts; other variant names (a provider's own presets) are not.
// ────────────────────────────────────────────────────────────────

import type { HarnessModel } from '@generatorai/core';
import type { Model_Info, Model_Ref } from '../../protocol/opencode.generated.js';

export type ModelRef = Model_Ref;
export type OpenCodeModelInfo = Model_Info;

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type OpenCodeEffort = (typeof EFFORTS)[number];

/** The model's variants that are effort levels, in effort order. */
export function effortVariants(model: Pick<Model_Info, 'variants'>): OpenCodeEffort[] {
  const ids = new Set((model.variants ?? []).map((v) => v.id));
  return EFFORTS.filter((e) => ids.has(e));
}

/** `providerID/id` — the qualified id the picker shows and sends back. */
export function qualifiedModelId(m: { providerID: string; id: string }): string {
  return `${m.providerID}/${m.id}`;
}

/**
 * `providerID/modelID` → the wire reference. Model ids may themselves contain
 * slashes (`openrouter/anthropic/claude-…`); provider ids never do, so the
 * split is at the first one. A bare id has no provider to address and is null.
 */
export function parseModelRef(model: string | undefined, variant?: string): ModelRef | null {
  if (!model) return null;
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) return null;
  return { providerID: model.slice(0, slash), id: model.slice(slash + 1), ...(variant ? { variant } : {}) };
}

/** One catalog row, copying only what OpenCode reported (D-131). */
export function toHarnessModel(m: Model_Info, isDefault: boolean): HarnessModel {
  const efforts = effortVariants(m);
  const cost = m.cost?.[0];
  const promptTokenLimit = m.limit?.input ?? m.limit?.context;
  return {
    id: qualifiedModelId(m),
    name: m.name || m.id,
    provider: 'opencode',
    ...(isDefault ? { isDefault: true } : {}),
    ...(m.family ? { category: m.family } : {}),
    inputModalities: [...(m.capabilities?.input ?? [])],
    supportsVision: (m.capabilities?.input ?? []).includes('image'),
    supportsReasoning: efforts.length > 0,
    ...(efforts.length > 0 ? { reasoningEfforts: [...efforts] } : {}),
    ...(promptTokenLimit ? { promptTokenLimit } : {}),
    ...(m.limit?.context ? { totalContextWindow: m.limit.context } : {}),
    ...(m.limit?.output ? { maxOutputTokens: m.limit.output } : {}),
    ...(cost ? { pricing: { input: cost.input, output: cost.output, cached: cost.cache?.read } } : {}),
  };
}

/** Whether a catalog row can run a chat turn. */
export function isUsableChatModel(m: Model_Info): boolean {
  return m.enabled !== false && m.status !== 'deprecated' && (m.type === undefined || m.type === 'chat');
}

// ────────────────────────────────────────────────────────────────
// Reasoning-effort levels and context tiers for a create-flow model
// selection (P5-09; ChatCreate/ChatCreateOrchestrator boards' Effort and
// Context segmented controls).
//
// A stripped-down, session-free version of
// `blocks/composer/hooks/useComposerModelControls.ts`'s effort/context-tier
// logic: that hook reads `useStreamStore` for the LIVE session's usage,
// which does not exist yet for a chat that has not been created. Pure
// functions over `HarnessCatalogModel`, no hook — both `NewChatDialog` and
// `ChatCreatePage` call `useModels()` themselves and pass the resolved
// model in.
// ────────────────────────────────────────────────────────────────

import type { Agent, HarnessCatalogModel } from '@generatorai/shared';

export type ContextTier = 'default' | 'long_context';

/** `[]` when the model does not support reasoning at all. */
export function reasoningLevelsFor(model: HarnessCatalogModel | undefined): readonly string[] {
  if (!model?.supportsReasoning) return [];
  return model.reasoningEfforts?.length ? model.reasoningEfforts : ['low', 'medium', 'high'];
}

/** The level to preselect: the model's own default, else the middle of the list. */
export function defaultReasoningEffortFor(model: HarnessCatalogModel | undefined): string | undefined {
  const levels = reasoningLevelsFor(model);
  if (levels.length === 0) return undefined;
  return model?.defaultReasoningEffort ?? levels[Math.floor(levels.length / 2)];
}

export interface ContextTierOption {
  tier: ContextTier;
  tokens: number;
}

/** `[]` unless the model offers a genuinely larger long-context tier. */
export function contextTiersFor(model: HarnessCatalogModel | undefined): readonly ContextTierOption[] {
  const standard = model?.promptTokenLimit;
  const long = model?.longContext?.promptTokenLimit;
  if (!standard || !long || standard >= long) return [];
  return [
    { tier: 'default', tokens: standard },
    { tier: 'long_context', tokens: long },
  ];
}

/**
 * The model and effort a chosen agent runs on. The create flows show (and send) these instead of the defaults:
 * the chat's own model outranks the agent's at run time (AgentResolver, most specific wins), so keeping the default
 * there would silently run an Opus agent on the default model.
 */
export function agentRuntimeSelection(agent: Pick<Agent, 'runtime'> | undefined): { model?: string; reasoningEffort?: string } {
  const runtime = agent?.runtime;
  return {
    ...(runtime?.model ? { model: runtime.model } : {}),
    ...(runtime?.reasoningEffort ? { reasoningEffort: runtime.reasoningEffort } : {}),
  };
}

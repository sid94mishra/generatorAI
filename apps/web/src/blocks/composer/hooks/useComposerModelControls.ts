// ────────────────────────────────────────────────────────────────
// useComposerModelControls — the model and the per-turn controls it drives
// (03-component-inventory-domain.md §6.1, F-composer-06/08/09/11): the live
// catalog, the selection resolved against it (substituted only when the
// catalog is conclusive, and persisted once), reasoning-effort levels, and the
// context-window tiers whose active figure agrees with the live session limit
// within 15 %.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef } from 'react';
import type { HarnessCatalogModel } from '@generatorai/shared';
import { resolveModelLimit } from '@generatorai/client-core';
import { useModels, useHarnessProviders } from '@/hooks/harnessQueries.js';
import { useStreamStore } from '@/stores/streamStore.js';

export type ContextTier = 'default' | 'long_context';

export interface UseComposerModelControlsOptions {
  /** Session whose stream carries the live usage / context snapshot. */
  sessionId: string;
  selectedModel: string | undefined;
  onModelChange: ((model: string) => void) | undefined;
  reasoningEffort: string | undefined;
  contextTier: string | undefined;
}

export function useComposerModelControls({
  sessionId,
  selectedModel,
  onModelChange,
  reasoningEffort,
  contextTier,
}: UseComposerModelControlsOptions) {
  const usage = useStreamStore((state) => state.streams[sessionId]?.usage ?? null);
  const contextUsage = useStreamStore((state) => state.streams[sessionId]?.contextUsage ?? null);
  const { data: models, isPending: modelsPending } = useModels();

  const modelList = useMemo(() => (models ?? []) as HarnessCatalogModel[], [models]);
  // Resolve the selection against the LIVE catalog.
  //
  // A chat can carry a model id the account no longer has (a renamed or
  // de-entitled model, or the legacy `claude-sonnet-4` default). When that
  // happened `activeModel` came back undefined and every model-derived
  // control — reasoning effort, context tier, and the context gauge —
  // silently vanished from the composer. Falling back to the first available
  // model keeps the toolbar intact and keeps the label honest about what
  // will actually be used.
  //
  // The catalog only lists models of providers that are ready right now, so a
  // selection can also be missing because its provider is briefly not ready
  // (a re-probe, a CLI restart, a stale disk cache). That is not a reason to
  // move the chat to another provider's model: substitute only when the
  // absence is conclusive — a fresh catalog in which every installed provider
  // answered.
  const { data: providerCatalog } = useHarnessProviders();
  const catalogIsConclusive =
    !!providerCatalog && !providerCatalog.stale && providerCatalog.providers.every((p) => p.ready || !p.installed);
  const displayModel = useMemo(() => {
    if (selectedModel && modelList.some((m) => m.id === selectedModel)) return selectedModel;
    if (selectedModel && !catalogIsConclusive) return selectedModel;
    return modelList[0]?.id ?? selectedModel ?? '';
  }, [selectedModel, modelList, catalogIsConclusive]);
  const activeModel = useMemo(
    () => modelList.find((m) => m.id === displayModel),
    [modelList, displayModel],
  );

  // Persist the substitution so the label, the gauge and the model the server
  // actually runs stay in agreement. Only fires when we genuinely had to
  // substitute (no selection, or a selection a conclusive catalog no longer
  // offers) — not on every open — and self-terminates once the parent echoes
  // it back.
  const onModelChangeRef = useRef(onModelChange);
  onModelChangeRef.current = onModelChange;
  useEffect(() => {
    if (modelList.length === 0) return;
    if (!displayModel || displayModel === selectedModel) return;
    onModelChangeRef.current?.(displayModel);
  }, [displayModel, selectedModel, modelList.length]);

  // Reasoning-effort levels come from the selected model's provider metadata.
  const reasoningLevels = activeModel?.supportsReasoning
    ? (activeModel.reasoningEfforts?.length ? activeModel.reasoningEfforts : ['low', 'medium', 'high'])
    : [];
  const effectiveEffort = reasoningEffort ?? activeModel?.defaultReasoningEffort ?? reasoningLevels[Math.floor(reasoningLevels.length / 2)];

  // Context-window tiers — offered only when the model exposes both a standard
  // and a long-context tier. Values are the provider's PROMPT budgets, which is
  // the same quantity the gauge divides by; showing the advertised total here
  // is what made the composer say 264K while the gauge said 200K.
  const contextTiers = useMemo(() => {
    const standard = resolveModelLimit(activeModel, 'default');
    const long = resolveModelLimit(activeModel, 'long_context');
    if (!activeModel?.supportsLongContext || !standard || !long || standard >= long) {
      return [] as Array<{ tier: ContextTier; tokens: number }>;
    }
    // ONE number per window. The catalog's figure is derived (window minus
    // the completion reserve: 936K); the running session reports its own
    // (1.00M), and that is what the gauge divides by. Side by side in the same
    // toolbar they read as two different windows. When the session's figure
    // is plainly the same tier measured differently — within 15% — it wins,
    // so the chip and the gauge beside it always agree.
    const live = contextUsage?.promptTokenLimit;
    const agree = (catalog: number): number =>
      typeof live === 'number' && live > 0 && Math.abs(live - catalog) / catalog < 0.15 ? live : catalog;
    const active = (contextTier as ContextTier | undefined) ?? 'default';
    return [
      { tier: 'default' as const, tokens: active === 'default' ? agree(standard) : standard },
      { tier: 'long_context' as const, tokens: active === 'long_context' ? agree(long) : long },
    ];
  }, [activeModel, contextUsage?.promptTokenLimit, contextTier]);
  const effectiveTier = (contextTier as ContextTier | undefined) ?? 'default';
  const activeTierTokens = contextTiers.find((t) => t.tier === effectiveTier)?.tokens
    ?? resolveModelLimit(activeModel, effectiveTier);
  const hasReasoning = !!activeModel?.supportsReasoning && reasoningLevels.length > 0;
  const hasContext = contextTiers.length > 1;

  return {
    /** The catalog is still loading — the composer shows its skeleton. */
    modelsPending,
    displayModel,
    activeModel,
    reasoningLevels,
    effectiveEffort,
    contextTiers,
    effectiveTier,
    activeTierTokens,
    hasReasoning,
    hasContext,
    usage,
    contextUsage,
  };
}

export type ComposerModelControls = ReturnType<typeof useComposerModelControls>;

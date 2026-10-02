// MB-02 Turn sheet (MModelPicker; `/chats/[id]/turn`, MD-03): "Next turn" — Provider (ready ones; others locked with
// "isn't signed in" and the way to fix it), Model (MB-03), Mode (Auto / Plan, `composer-mode`) with its help line,
// Effort (the model's own levels), Context (Standard / Long when the model has both), Approvals, and the context
// usage row (MB-41). A selection sheet: "Done" in the header applies (MD-85); ✕ with changes asks first.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { findPickerModel, type AgentMode, type ModelPickerCatalog } from '@generatorai/client-core';

import { ContextUsage, contextUsageView } from '../ContextUsage';
import { MODE_OPTIONS, PERMISSION_MODES, TIER_OPTIONS, effortTitle, type ContextTier } from '../Composer/model/turnOptions';
import { ModelPicker } from '../ModelPicker';
import { ListSection } from '../../ui/layout/ListSection';
import { RouteSheet } from '../../ui/native/Sheet';
import type { RemovalSource } from '../../ui/layout/DirtyGuard/DirtyGuard.types';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Select } from '../../ui/native/Select';
import { haptic } from '../../ui/platform/haptics';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { formatTokenLimit } from '@generatorai/client-core';
import { useApplyTurn, useLiveContextUsage, useModelPickerCatalog, useTurnChat } from './TurnSheet.queries';

export interface TurnSheetProps {
  chatId: string;
  onClose: () => void;
  navigation?: RemovalSource;
}

interface TurnState {
  provider: string | null;
  model: string | null;
  mode: AgentMode;
  effort: string | null;
  tier: ContextTier;
  permission: string;
}

function Section({ title, children, help }: { title: string; children: React.ReactNode; help?: string | null }): React.ReactElement {
  return (
    <View className="gap-2">
      <Text role="footnote" weight={600} tone="fg-2">
        {title}
      </Text>
      {children}
      {help ? (
        <Text role="footnote" tone="fg-3">
          {help}
        </Text>
      ) : null}
    </View>
  );
}

function TurnBody({ chatId, initial, catalog, harness, streamKey, onClose, navigation }: { chatId: string; initial: TurnState; catalog: ModelPickerCatalog; harness: Record<string, unknown>; streamKey: string; onClose: () => void; navigation?: RemovalSource }): React.ReactElement {
  const [state, setState] = useState<TurnState>(initial);
  const apply = useApplyTurn(chatId);
  const usage = useLiveContextUsage(streamKey);
  const model = findPickerModel(catalog, state.model, state.provider);
  const provider = catalog.providers.find((p) => p.type === state.provider) ?? null;
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const usageView = contextUsageView(usage, state.tier === 'long_context' ? (model?.longContextTokens ?? model?.contextTokens) : model?.contextTokens);
  const efforts = model?.reasoningEfforts ?? [];

  const done = (): void => {
    if (!dirty) return onClose();
    if (!state.model) return onClose();
    apply.mutate(
      {
        model: state.model,
        defaultAgentMode: state.mode,
        permissionMode: state.permission,
        harnessConfig: { ...harness, ...(state.effort ? { reasoningEffort: state.effort } : {}), contextTier: state.tier },
      },
      {
        onSuccess: () => {
          haptic('success');
          onClose();
        },
        onError: () => toast({ kind: 'error', message: "Couldn't change the next turn. Try again." }),
      },
    );
  };

  const locked = provider && provider.availability !== 'ready';
  return (
    <RouteSheet title="Next turn" onDismiss={onClose} dirty={dirty} headerAction={{ label: 'Done', onPress: done, disabled: apply.isPending }} scrollable navigation={navigation} testID="turn-sheet">
      <View className="gap-5 px-4">
        {catalog.providers.length > 1 ? (
          <Section title="Provider" help={locked ? `${provider.label} isn't signed in on this server. Sign in from Settings, then refresh.` : null}>
            <SegmentedControl
              accessibilityLabel="Provider"
              value={state.provider ?? ''}
              onValueChange={(p) => setState((s) => ({ ...s, provider: p, model: catalog.providers.find((x) => x.type === p)?.models[0]?.id ?? s.model }))}
              segments={catalog.providers.map((p) => ({ value: p.type, label: p.label, ...(p.availability !== 'ready' ? { locked: true } : {}) }))}
              fullWidth
              testID="turn-provider"
            />
          </Section>
        ) : null}
        <Section title="Model">
          <ModelPicker catalog={catalog} value={state.model && state.provider ? { provider: state.provider, model: state.model } : null} providerFilter={state.provider} onValueChange={(v) => setState((s) => ({ ...s, provider: v.provider, model: v.model, effort: null }))} />
        </Section>
        <Section title="Mode" help={MODE_OPTIONS.find((o) => o.value === state.mode)?.help ?? null}>
          <SegmentedControl<AgentMode> accessibilityLabel="Mode" value={state.mode} onValueChange={(mode) => setState((s) => ({ ...s, mode }))} segments={MODE_OPTIONS.map((o) => ({ value: o.value, label: o.value === 'plan' ? 'Plan' : o.title, icon: o.value === 'plan' ? 'plan' : 'zap' }))} fullWidth testID="composer-mode" />
        </Section>
        {efforts.length ? (
          <Section title="Effort">
            <SegmentedControl accessibilityLabel="Effort" value={state.effort ?? model?.defaultReasoningEffort ?? efforts[0]!} onValueChange={(effort) => setState((s) => ({ ...s, effort }))} segments={efforts.map((e) => ({ value: e, label: effortTitle(e) }))} fullWidth testID="turn-effort" />
          </Section>
        ) : null}
        {model?.longContextTokens ? (
          <Section title="Context">
            <SegmentedControl<ContextTier>
              accessibilityLabel="Context"
              value={state.tier}
              onValueChange={(tier) => setState((s) => ({ ...s, tier }))}
              segments={TIER_OPTIONS.map((o) => ({ value: o.value, label: `${o.value === 'default' ? 'Standard' : 'Long'} ${formatTokenLimit(o.value === 'default' ? (model.contextTokens ?? 0) : model.longContextTokens!)}` }))}
              fullWidth
              testID="turn-context"
            />
          </Section>
        ) : null}
        <ListSection>
          <Select label="Approvals" value={state.permission} options={PERMISSION_MODES.map((o) => ({ value: o.value, label: o.title, description: o.help }))} onValueChange={(permission) => setState((s) => ({ ...s, permission }))} testID="turn-permission" />
        </ListSection>
        {usageView ? <ContextUsage view={usageView} /> : null}
      </View>
    </RouteSheet>
  );
}

export function TurnSheet({ chatId, onClose, navigation }: TurnSheetProps): React.ReactElement {
  const chat = useTurnChat(chatId);
  const { catalog, loading, error, refresh } = useModelPickerCatalog();
  const harness = useMemo(() => ((chat.data as { harnessConfig?: Record<string, unknown> } | undefined)?.harnessConfig ?? {}), [chat.data]);
  if (!chat.data || !catalog) {
    return (
      <RouteSheet title="Next turn" onDismiss={onClose} navigation={navigation}>
        <View className="px-4">
          {error ? <ErrorState title="Couldn't load the models" error={error} onRetry={refresh} /> : loading || chat.isLoading ? <Skeleton preset="list" count={5} /> : <ErrorState title="Couldn't load this chat" error={chat.error} onRetry={() => void chat.refetch()} />}
        </View>
      </RouteSheet>
    );
  }
  const current = findPickerModel(catalog, chat.data.model);
  const initial: TurnState = {
    provider: current?.provider ?? catalog.defaultProvider,
    model: chat.data.model ?? null,
    mode: chat.data.defaultAgentMode ?? 'auto',
    effort: typeof harness['reasoningEffort'] === 'string' ? (harness['reasoningEffort'] as string) : null,
    tier: harness['contextTier'] === 'long_context' ? 'long_context' : 'default',
    permission: chat.data.permissionMode ?? 'default',
  };
  return <TurnBody chatId={chatId} initial={initial} catalog={catalog} harness={harness} streamKey={chat.data.sessionId ?? chatId} onClose={onClose} {...(navigation ? { navigation } : {})} />;
}

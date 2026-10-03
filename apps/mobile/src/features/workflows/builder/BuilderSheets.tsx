// The builder's route sheets (`/workflows/[id]/edit/add-stage?after=`, `…/edit/loop/[stageKey]`; MBuilderGraph "Add
// stage", MBuilderLoop "Loop settings"; MD-85: they edit the builder draft; the builder's Save commits). Add stage: the stage kinds with a line each (search); a kind
// the device may not add is locked with the reason (a check runs a command: admin only, the server's command-bearing
// rule). Loop settings: max iterations, the exit rules (when / action / in a row / reason — simple fields; nothing
// else), carried values read-only, the loop budget (turns, cost) and what exhausting it does (Pause, Fail, Accept
// last; "Accept best" needs a score expression: desktop).
import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import type { ExitRule, LoopStage, StageKind } from '@generatorai/workflow-spec';

import { useGrantedScopes } from '../../../services/auth/useCapability';

import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { SegmentedControl } from '../../../ui/native/SegmentedControl';
import { RouteSheet } from '../../../ui/native/Sheet';
import { ChoiceCard } from '../../../ui/primitives/ChoiceCard';
import { IconButton } from '../../../ui/primitives/IconButton';
import { Input } from '../../../ui/primitives/Input';
import { SearchInput } from '../../../ui/primitives/SearchInput';
import { Text } from '../../../ui/primitives/Text';
import { KIND_NAME, insertAfter, newStage } from '../model/builderModel';
import { useBuilderStore } from './builderStore';
import { useBuilderDraft } from './useBuilderDraft';

export const KIND_ICON = { agent: 'agents', check: 'check', loop: 'repeat', map: 'layers', subworkflow: 'workflows', wait: 'hourglass' } as const;

const KIND_LINE: Record<StageKind, string> = {
  agent: 'An agent turn (the default)',
  check: 'Runs one allowlisted command, no LLM',
  loop: 'Repeats its body until a rule fires',
  map: 'Runs its body once per item of a list',
  subworkflow: 'Runs another published workflow',
  wait: 'Approval form, external event or timer',
};

const close = (): void => {
  if (router.canGoBack()) router.back();
};

/** Add stage (`?after=<stageKey>`; MBuilderGraph sheet): a kind lands after that stage and becomes the selection. */
export function AddStageSheet(): React.ReactElement {
  const { id = '', after = '' } = useLocalSearchParams<{ id: string; after?: string }>();
  const navigation = useNavigation();
  const { draft } = useBuilderDraft(id);
  const isAdmin = useGrantedScopes().includes('admin:settings');
  const [query, setQuery] = useState('');
  const afterName = after ? (draft?.graph.stages.find((s) => s.key === after)?.name ?? after) : null;
  const kinds = (Object.keys(KIND_NAME) as StageKind[]).filter((k) => !query.trim() || `${KIND_NAME[k]} ${KIND_LINE[k]}`.toLowerCase().includes(query.trim().toLowerCase()));
  const add = (kind: StageKind): void => {
    const store = useBuilderStore.getState();
    const graph = store.drafts[id]?.graph;
    if (!graph) return;
    const stage = newStage(kind, graph);
    store.edit(id, (g) => insertAfter(g, after || null, stage));
    store.select(id, stage.key);
    close();
  };
  return (
    <RouteSheet title="Add stage" subtitle={afterName ? `After ${afterName}` : 'At the end'} onDismiss={close} scrollable navigation={navigation as never} testID="add-stage-sheet">
      <View className="gap-3 pb-4">
        <SearchInput value={query} onChangeText={setQuery} placeholder="Search stage kinds" size="compact" />
        <View className="gap-2">
          {kinds.map((k) => (
            <ChoiceCard
              key={k}
              value={k}
              selected={false}
              title={k === 'agent' ? 'Agent' : KIND_NAME[k]}
              description={KIND_LINE[k]}
              icon={KIND_ICON[k]}
              {...(k === 'check' && !isAdmin ? { locked: 'Needs admin access: a check runs a command' } : {})}
              onPress={() => add(k)}
              testID={`add-stage-${k}`}
            />
          ))}
        </View>
      </View>
    </RouteSheet>
  );
}

const ACTION_WORD: Record<ExitRule['action'], string> = { complete: 'Until', fail: 'Fail when', pause: 'Pause when', exhaust: 'Stop when' };

type OnLimitMode = 'pause' | 'fail' | 'accept_last';

/** Loop settings (`/workflows/[id]/edit/loop/[stageKey]`; MBuilderLoop): ✕ · "Loop settings" · Done. */
export function LoopSettingsSheet(): React.ReactElement {
  const { id: workflowId = '', stageKey = '' } = useLocalSearchParams<{ id: string; stageKey: string }>();
  const navigation = useNavigation();
  const { draft } = useBuilderDraft(workflowId);
  const stage = draft?.graph.stages.find((x) => x.key === stageKey);
  return (
    <RouteSheet title="Loop settings" subtitle={stage?.name ?? stageKey} onDismiss={close} headerAction={{ label: 'Done', onPress: close }} scrollable navigation={navigation as never} testID="loop-settings-sheet">
      {stage?.kind === 'loop' ? <LoopForm workflowId={workflowId} stage={stage} /> : <Text role="body" tone="fg-3">{draft ? 'This loop is no longer in the draft.' : 'Loading…'}</Text>}
    </RouteSheet>
  );
}

function LoopForm({ workflowId, stage }: { workflowId: string; stage: LoopStage }): React.ReactElement {
  const stageKey = stage.key;
  const edit = useBuilderStore((s) => s.edit);
  const onChange = (next: LoopStage): void => edit(workflowId, (g) => ({ ...g, stages: g.stages.map((x) => (x.key === stageKey ? next : x)) }));
  const loop = stage.loop;
  const set = (patch: Partial<LoopStage['loop']>): void => onChange({ ...stage, loop: { ...loop, ...patch } });
  const setRule = (i: number, patch: Partial<ExitRule>): void => set({ exits: loop.exits.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const carry = Object.entries(loop.carry ?? {});
  const budget = stage.budget ?? {};
  const best = loop.onLimit.mode === 'accept_best';
  return (
    <View className="gap-4 pb-6">
      <ListSection>
        <ListRow kind="stepper" title="Max iterations" stepper={{ value: loop.maxIterations, onValueChange: (maxIterations) => set({ maxIterations }), min: 1, max: 50, testID: 'loop-max' }} />
      </ListSection>
      <ListSection title="Exit rules" count={loop.exits.length} action={loop.exits.length < 12 ? { label: 'Add rule', onPress: () => set({ exits: [...loop.exits, { when: '', action: 'complete', consecutive: 1, reason: `rule_${loop.exits.length + 1}` }] }) } : undefined}>
        {loop.exits.length === 0 ? <ListRow kind="info" title="No exit rules" subtitle="The loop runs to its maximum, then applies On limit." /> : null}
        {loop.exits.map((rule, i) => (
          <View key={i} className="gap-2 px-4 py-3">
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
                <SegmentedControl<ExitRule['action']>
                  accessibilityLabel={`Rule ${i + 1} action`}
                  value={rule.action}
                  onValueChange={(action) => setRule(i, { action })}
                  segments={(['complete', 'fail', 'pause', 'exhaust'] as const).map((a) => ({ value: a, label: ACTION_WORD[a].split(' ')[0]! }))}
                  fullWidth
                />
              </View>
              <IconButton icon="trash" label={`Remove rule ${i + 1}`} size="sm" onPress={() => set({ exits: loop.exits.filter((_, j) => j !== i) })} />
            </View>
            <Input label={ACTION_WORD[rule.action]} value={rule.when} onChangeText={(when) => setRule(i, { when })} kind="mono" presentation="standalone" placeholder="stages.review.output.verdict == 'approve'" testID={`loop-rule-${i}-when`} />
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Input label="Reason" value={rule.reason} onChangeText={(reason) => setRule(i, { reason: reason.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) })} kind="mono" presentation="standalone" />
              </View>
              <View className="w-32">
                <Input label="In a row" value={String(rule.consecutive)} onChangeText={(t) => setRule(i, { consecutive: Math.min(10, Math.max(1, Number(t) || 1)) })} kind="number" presentation="standalone" />
              </View>
            </View>
          </View>
        ))}
      </ListSection>
      {carry.length ? (
        <ListSection title="Carry" footer="Carried values are edited on desktop.">
          {carry.map(([k, expr]) => (
            <ListRow key={k} kind="value" title={k} value={expr} mono />
          ))}
        </ListSection>
      ) : null}
      <ListSection title="Budget">
        <ListRow kind="stepper" title="Max turns" subtitle={budget.maxTurns ? undefined : 'No limit'} stepper={{ value: budget.maxTurns ?? 0, onValueChange: (n) => onChange({ ...stage, budget: { ...budget, ...(n > 0 ? { maxTurns: n } : { maxTurns: undefined }) } }), min: 0, max: 100_000, step: 10, format: (v) => (v ? String(v) : 'Off') }} />
        <Input label="Max cost (USD)" value={budget.maxCostUsd ? String(budget.maxCostUsd) : ''} onChangeText={(t) => onChange({ ...stage, budget: { ...budget, maxCostUsd: Number(t) > 0 ? Number(t) : undefined } })} kind="number" placeholder="No limit" />
      </ListSection>
      <View className="gap-2 px-4">
        <Text role="subhead" weight={600}>
          On limit
        </Text>
        {best ? (
          <Text role="footnote" tone="fg-3">
            Accept best (by a score expression) — change it on desktop.
          </Text>
        ) : (
          <SegmentedControl<OnLimitMode>
            accessibilityLabel="On limit"
            value={loop.onLimit.mode as OnLimitMode}
            onValueChange={(mode) => set({ onLimit: { mode } })}
            segments={[
              { value: 'pause', label: 'Pause' },
              { value: 'fail', label: 'Fail' },
              { value: 'accept_last', label: 'Accept last' },
            ]}
            fullWidth
            testID="loop-on-limit"
          />
        )}
      </View>
    </View>
  );
}

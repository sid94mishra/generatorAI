// Policy tab (MStagePolicy, MStagePolicyMore): Approval (+ allow changes, max rounds); Join and Guard read-only
// (MD-04: they belong to the graph, edited on desktop); Timeouts; Budget; Retry (attempts, delays, multiplier,
// jitter, the error groups that retry, resume / restart, the generated sentence); When exhausted.
import React from 'react';
import { View } from 'react-native';
import { ApprovalSpecSchema, RetryPolicySchema, type AgentStage, type Budget, type RetryPolicy, type Timeouts } from '@generatorai/workflow-spec';

import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { ChipGroup } from '../../../ui/primitives/ChipGroup';
import { Input } from '../../../ui/primitives/Input';
import { Text } from '../../../ui/primitives/Text';
import { DurationInput, OptionalNumberInput, type TabProps } from './fields';
import { RETRY_GROUPS, retryGroupsOn, retryOnFor, retrySentence } from './stageEditorModel';

const JOIN_WORDS: Record<AgentStage['join']['mode'], { label: string; line: string }> = {
  all: { label: 'All', line: 'Runs when every incoming edge has fired.' },
  any: { label: 'Any', line: 'Runs when the first incoming edge fires.' },
  n_of_m: { label: 'N of M', line: 'Runs once n incoming edges have fired.' },
};

function prune<T extends object>(o: T): T | undefined {
  const next = { ...o };
  for (const k of Object.keys(next) as (keyof T)[]) if (next[k] === undefined) delete next[k];
  return Object.keys(next).length ? next : undefined;
}

export function PolicyTab({ stage, set }: TabProps): React.ReactElement {
  const approval = stage.approval;
  const join = stage.join;
  const t = stage.timeouts ?? {};
  const b = stage.budget ?? {};
  const retry = stage.retry;
  const setTimeouts = (patch: Partial<Timeouts>): void => set({ ...stage, timeouts: prune({ ...t, ...patch }) });
  const setBudget = (patch: Partial<Budget>): void => set({ ...stage, budget: prune({ ...b, ...patch }) });
  const setRetry = (patch: Partial<RetryPolicy>): void => retry && set({ ...stage, retry: { ...retry, ...patch } });
  const groups = retryGroupsOn(retry?.retryOn);

  return (
    <View className="gap-6">
      <ListSection>
        <ListRow kind="toggle" title="Approval" subtitle="A person approves, requests changes or rejects." icon="hand" switchValue={Boolean(approval)} onValueChange={(on) => set({ ...stage, approval: on ? ApprovalSpecSchema.parse({}) : undefined })} testID="stage-approval" />
        <ListRow kind="toggle" title="Allow changes" switchValue={approval?.allowChanges ?? false} onValueChange={(allowChanges) => approval && set({ ...stage, approval: { ...approval, allowChanges } })} disabled={!approval} />
        <ListRow kind="stepper" title="Max rounds" stepper={{ value: approval?.maxRounds ?? 3, onValueChange: (maxRounds) => approval && set({ ...stage, approval: { ...approval, maxRounds } }), min: 1, max: 10, disabled: !approval?.allowChanges }} />
      </ListSection>

      <ListSection title="Join" footer={`${JOIN_WORDS[join.mode].line} Join and guard are edited on desktop.`}>
        <ListRow kind="value" title="Join" value={join.mode === 'n_of_m' ? `${join.n} of M` : JOIN_WORDS[join.mode].label} />
        {join.mode !== 'all' ? <ListRow kind="value" title="Cancel the rest" value={join.cancelRemaining ? 'On' : 'Off'} /> : null}
        <ListRow kind="value" title="Run only when" value={stage.guard ?? 'Always'} mono={Boolean(stage.guard)} />
      </ListSection>

      <ListSection title="Timeouts">
        <View className="gap-2 px-4 py-3">
          <View className="flex-row gap-2">
            <View className="flex-1">
              <DurationInput label="Attempt" value={t.attemptMs} onChange={(attemptMs) => setTimeouts({ attemptMs })} testID="stage-timeout-attempt" />
            </View>
            <View className="flex-1">
              <DurationInput label="Idle" value={t.idleMs} onChange={(idleMs) => setTimeouts({ idleMs })} placeholder="10m" />
            </View>
          </View>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <DurationInput label="Total" value={t.totalMs} onChange={(totalMs) => setTimeouts({ totalMs })} />
            </View>
            <View className="flex-1">
              <DurationInput label="Queue" value={t.queueMs} onChange={(queueMs) => setTimeouts({ queueMs })} placeholder="30m" />
            </View>
          </View>
        </View>
      </ListSection>

      <ListSection title="Budget">
        <View className="flex-row gap-2 px-4 py-3">
          <View className="flex-1">
            <OptionalNumberInput label="Max turns" value={b.maxTurns} onChange={(maxTurns) => setBudget({ maxTurns: maxTurns ? Math.floor(maxTurns) : undefined })} />
          </View>
          <View className="flex-1">
            <OptionalNumberInput label="Max cost ($)" value={b.maxCostUsd} onChange={(maxCostUsd) => setBudget({ maxCostUsd })} />
          </View>
          <View className="flex-1">
            <DurationInput label="Wall clock" value={b.maxWallClockMs} onChange={(maxWallClockMs) => setBudget({ maxWallClockMs })} />
          </View>
        </View>
      </ListSection>

      <ListSection title="Retry">
        <ListRow kind="toggle" title="Retry on failure" switchValue={Boolean(retry)} onValueChange={(on) => set({ ...stage, retry: on ? RetryPolicySchema.parse({ maxAttempts: 3, initialDelayMs: 1000 }) : undefined })} testID="stage-retry" />
        {retry ? (
          <View className="gap-3 px-4 py-3">
            <ListRow kind="stepper" title="Max attempts" stepper={{ value: retry.maxAttempts, onValueChange: (maxAttempts) => setRetry({ maxAttempts }), min: 1, max: 10 }} />
            <View className="flex-row gap-2">
              <View className="flex-1">
                <DurationInput label="Initial delay" value={retry.initialDelayMs} onChange={(ms) => setRetry({ initialDelayMs: ms ?? 0 })} />
              </View>
              <View className="flex-1">
                <Input label="Multiplier" value={String(retry.backoffMultiplier)} onChangeText={(v) => setRetry({ backoffMultiplier: Math.min(10, Math.max(1, Number(v) || 1)) })} kind="number" presentation="standalone" />
              </View>
            </View>
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
                <DurationInput label="Max delay" value={retry.maxDelayMs} onChange={(ms) => setRetry({ maxDelayMs: ms ?? 60_000 })} />
              </View>
              <View className="flex-1">
                <ListRow kind="toggle" title="Jitter" switchValue={retry.jitter !== 'none'} onValueChange={(on) => setRetry({ jitter: on ? 'full' : 'none' })} />
              </View>
            </View>
            <Text role="footnote" tone="fg-3">
              Retry on
            </Text>
            <ChipGroup
              accessibilityLabel="Retry on"
              selection="multi"
              layout="wrap"
              items={RETRY_GROUPS.map((g) => ({ id: g.id, label: g.label }))}
              value={groups}
              onValueChange={(v) => setRetry({ retryOn: retryOnFor(v as string[], retry.retryOn) })}
              testID="stage-retry-on"
            />
            <ListRow kind="segmented" title="Mode" subtitle="Resume keeps settled turns" segmented={{ value: retry.mode, onValueChange: (mode) => setRetry({ mode: mode as RetryPolicy['mode'] }), segments: [{ value: 'resume', label: 'Resume' }, { value: 'restart', label: 'Restart' }] }} />
          </View>
        ) : null}
      </ListSection>
      {retry ? (
        <Text role="footnote" tone="fg-3" testID="stage-retry-sentence">
          {retrySentence(retry, stage.onExhausted ?? 'pause')}
        </Text>
      ) : null}

      <ListSection title="When exhausted">
        <ListRow kind="segmented" title="After the last attempt" segmented={{ value: stage.onExhausted ?? 'pause', onValueChange: (v) => set({ ...stage, onExhausted: v as 'pause' | 'fail' }), segments: [{ value: 'pause', label: 'Pause for a person' }, { value: 'fail', label: 'Fail' }], testID: 'stage-on-exhausted' }} />
      </ListSection>
    </View>
  );
}

// MB-34 DecisionCard (03 MB-34; MRunLoop, MWorkflowRun): a loop parked for a person, in the gate shell — "Needs
// decision" with the loop key; the headline ("Paused · budget reached", "Ran out · max iterations") and the spend;
// the server's commands as buttons: Grant +1, Grant +2, Raise budget…, Continue with input…, Accept, Accept
// iteration…, Fail (destructive, confirmed). Loop decisions are run-time acts (`exec:agent`, P05), not approvals,
// so they are not signed. Inputs open in the one imperative sheet (MD-62).
import React, { useState } from 'react';
import { View } from 'react-native';

import { errorText } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Input } from '../../ui/primitives/Input';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { GateCardFrame } from '../GateCard';
import { useLoopCommand, useLoopIterations, type LoopCommand } from './DecisionCard.queries';
import { acceptableIterations, budgetParts, decisionHeadline, loopCommandError, loopDecisionOf, positive, reasonLabel } from './model/loopDecisionModel';

export interface DecisionCardProps {
  runId: string;
  /** A parked loop instance. */
  stage: { id: string; name?: string | null; stageKey: string; version?: number; interruptData?: unknown; loopState?: { effectiveMax?: number } | null };
  /** The device may decide (`exec:agent`). */
  canDecide: boolean;
  testID?: string;
}

type BudgetFields = Omit<Extract<LoopCommand, { command: 'raise_budget' }>, 'command' | 'instanceId' | 'expectedVersion'>;

function ContinueForm({ name, onSend }: { name: string; onSend: (text: string) => void }): React.ReactElement {
  const [text, setText] = useState('');
  return (
    <View className="gap-3 pb-4">
      <Text role="footnote" tone="fg-2">{`The next iteration of ${name} starts with this message.`}</Text>
      <Textarea label="Message" value={text} onChangeText={setText} minRows={3} placeholder="What should the next iteration do?" autoFocus testID="decision-input" />
      <Button label="Continue" variant="primary" size="lg" fullWidth disabled={!text.trim()} onPress={() => onSend(text.trim())} testID="decision-input-send" />
    </View>
  );
}

function BudgetForm({ onSend }: { onSend: (fields: BudgetFields) => void }): React.ReactElement {
  const [turns, setTurns] = useState('');
  const [cost, setCost] = useState('');
  const [tokens, setTokens] = useState('');
  const [minutes, setMinutes] = useState('');
  const fields: BudgetFields = {};
  const t = positive(turns, true);
  const c = positive(cost, false);
  const k = positive(tokens, true);
  const m = positive(minutes, false);
  if (t !== null) fields.maxTurns = t;
  if (c !== null) fields.maxCostUsd = c;
  if (k !== null) fields.maxTokens = k;
  if (m !== null) fields.maxWallClockMs = Math.max(1000, Math.round(m * 60_000));
  return (
    <View className="gap-3 pb-4">
      <Text role="footnote" tone="fg-2">
        Amounts are added to the loop's budget. Fill in only what ran out.
      </Text>
      <ListSection>
        <Input label="Turns" value={turns} onChangeText={setTurns} kind="number" placeholder="20" testID="decision-budget-turns" />
        <Input label="Cost (USD)" value={cost} onChangeText={setCost} kind="number" placeholder="2.50" />
        <Input label="Tokens" value={tokens} onChangeText={setTokens} kind="number" placeholder="200000" />
        <Input label="Wall clock (min)" value={minutes} onChangeText={setMinutes} kind="number" placeholder="30" />
      </ListSection>
      <Button label="Raise budget" variant="primary" size="lg" fullWidth disabled={Object.keys(fields).length === 0} onPress={() => onSend(fields)} testID="decision-budget-send" />
    </View>
  );
}

function IterationPicker({ runId, loopId, choices, lastK, scores, onPick }: { runId: string; loopId: string; choices: number[]; lastK: number; scores: Array<{ k: number; score: number | null }>; onPick: (k: number) => void }): React.ReactElement {
  const iterations = useLoopIterations(runId, loopId, true);
  return (
    <View className="gap-3 pb-4">
      <Text role="footnote" tone="fg-2">
        The loop completes with that iteration's output. An earlier one is offered only when its workspace was checkpointed.
      </Text>
      <ListSection>
        {[...choices].reverse().map((k) => {
          const row = iterations.data?.find((r) => r.k === k);
          const score = row?.score ?? scores.find((s) => s.k === k)?.score ?? null;
          return (
            <ListRow
              key={k}
              kind="navigation"
              title={`Iteration #${k}`}
              subtitle={[k === lastK ? 'Last iteration' : 'Restores its checkpoint', row?.outcome ? reasonLabel(row.outcome) : null, score !== null ? `score ${score}` : null].filter(Boolean).join(' · ')}
              onPress={() => onPick(k)}
              testID={`decision-iteration-${k}`}
            />
          );
        })}
      </ListSection>
    </View>
  );
}

export function DecisionCard({ runId, stage, canDecide, testID = 'decision-card' }: DecisionCardProps): React.ReactElement | null {
  const command = useLoopCommand(runId);
  const sheet = useSheet();
  const view = loopDecisionOf(stage.interruptData);
  if (!view) return null;
  const name = stage.name ?? stage.stageKey;
  const busy = command.isPending;
  const instanceId = stage.id;
  const max = view.maxIterations ?? stage.loopState?.effectiveMax ?? null;
  const spend = budgetParts(view);
  // Every decision carries the parked loop's version (LOOP-R14).
  const send = (body: LoopCommand): void => {
    sheet.dismiss();
    command.mutate(stage.version !== undefined ? { ...body, expectedVersion: stage.version } : body, {
      onSuccess: () => haptic('success'),
      onError: (e) => {
        haptic('error');
        toast({ kind: 'error', message: loopCommandError(e) || errorText(e) });
      },
    });
  };
  const off = !canDecide || busy;
  const half = (label: string, onPress: () => void, id: string, disabled = off): React.ReactElement => (
    <View className="flex-1">
      <Button label={label} fullWidth disabled={disabled} onPress={onPress} testID={`decision-${id}`} />
    </View>
  );
  return (
    <GateCardFrame title="Needs decision" meta={stage.stageKey} testID={testID}>
      <View className="gap-1">
        <Text role="subhead" weight={600}>
          {decisionHeadline(view)}
        </Text>
        <Text role="footnote" tone="fg-2">
          {[`${view.iterations} iteration${view.iterations === 1 ? '' : 's'} finished${max !== null ? ` of ${max}` : ''}`, ...spend].join(' · ')}
        </Text>
      </View>
      <View className="gap-2">
        <View className="flex-row gap-2">
          {half('Grant +1', () => send({ command: 'grant_iterations', instanceId, n: 1 }), 'grant-1')}
          {half('Grant +2', () => send({ command: 'grant_iterations', instanceId, n: 2 }), 'grant-2')}
        </View>
        <View className="flex-row gap-2">
          {half('Raise budget', () => sheet.present(<BudgetForm onSend={(f) => send({ command: 'raise_budget', instanceId, ...f })} />, { title: 'Raise budget', subtitle: name, detents: ['large'], scrollable: true }), 'budget')}
          {half('Continue with input…', () => sheet.present(<ContinueForm name={name} onSend={(text) => send({ command: 'continue_with_input', instanceId, text })} />, { title: 'Continue with input', subtitle: name, detents: ['large'] }), 'input')}
        </View>
        <View className="flex-row gap-2">
          {half('Accept', () => send({ command: 'accept', instanceId }), 'accept', off || view.k < 0)}
          {half(
            'Accept iteration…',
            () => sheet.present(<IterationPicker runId={runId} loopId={instanceId} choices={acceptableIterations(view)} lastK={view.k} scores={view.scores} onPick={(k) => send({ command: 'accept_iteration', instanceId, k })} />, { title: 'Accept which iteration?', subtitle: name, detents: ['medium', 'large'], scrollable: true }),
            'accept-iteration',
            off || view.k < 0,
          )}
        </View>
        <Button
          label="Fail"
          variant="destructive"
          fullWidth
          disabled={off}
          onPress={() =>
            void confirm({ title: `Fail ${name}?`, message: 'The loop fails and every stage after it is blocked. This cannot be undone.', confirmLabel: 'Fail loop', icon: 'status-failed' }).then((ok) => {
              if (ok) send({ command: 'fail', instanceId });
            })
          }
          testID="decision-fail"
        />
        {!canDecide ? (
          <Text role="footnote" tone="fg-3">
            Deciding for a loop needs permission to run agents on this device.
          </Text>
        ) : null}
      </View>
    </GateCardFrame>
  );
}

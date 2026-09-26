// ────────────────────────────────────────────────────────────────
// LoopDecisionCard — a loop parked on an operator decision (P05 WP-5A.5).
//
// The ApprovalCard's visual language (warning card, headline, the question,
// a primary action over secondary ones) with the loop's own decisions:
//   • Grant +1 / +2 — more iterations; the loop continues,
//   • Continue with input — the next iteration's first stages get the text,
//   • Accept — complete with the last iteration,
//   • Accept iteration k — an earlier checkpointed iteration (its workspace
//     is restored) or the last,
//   • Raise budget — turns, cost, tokens, wall clock,
//   • Fail — confirmed; the loop fails and its dependants are blocked.
// Each is one run command; refusals surface through `useLoopControl`.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Lock } from 'lucide-react-native';

import { useLoopControl, useLoopIterations, type LoopCommand } from '../../api/useLoopControl';
import { FeedbackSheet } from './FeedbackSheet';
import {
  acceptableIterations,
  budgetParts,
  decisionHeadline,
  loopDecisionOf,
  reasonLabel,
  type RunStage,
} from './loopModel';
import { ActionSheet, type MenuAction } from '../ui/ActionSheet';
import { Button } from '../ui/Button';
import { Field } from '../ui/Form';
import { Sheet } from '../ui/Sheet';
import { useCardEntering } from '../common/enterMotion';
import { useTheme } from '../../theme/ThemeProvider';

export function LoopDecisionCard({
  runId,
  stage,
  canControl,
  onRequestAccess,
}: {
  runId: string;
  /** A parked loop instance (`isParkedLoop`). */
  stage: RunStage;
  /** The device holds `runControl`; without it the card offers Request access. */
  canControl: boolean;
  onRequestAccess?: () => void;
}): React.ReactElement | null {
  const entering = useCardEntering();
  const { colors } = useTheme();
  const { command } = useLoopControl(runId);
  const [inputOpen, setInputOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [confirmFail, setConfirmFail] = useState(false);
  const iterations = useLoopIterations(runId, stage.id, pickOpen);

  const view = loopDecisionOf(stage.interruptData);
  if (!view) return null;
  const name = stage.name ?? stage.stageKey;
  const busy = command.isPending;
  // Every decision carries the parked loop's version: a stale card never acts on a later park (LOOP-R14).
  const send = (body: LoopCommand) => command.mutate(stage.version !== undefined ? { ...body, expectedVersion: stage.version } : body);
  const instanceId = stage.id;
  const lastK = view.k;
  const max = view.maxIterations ?? stage.loopState?.effectiveMax ?? null;
  const spend = budgetParts(view);

  const pickActions: MenuAction[] = acceptableIterations(view)
    .reverse()
    .map((k) => {
      const row = iterations.data?.find((r) => r.k === k);
      const score = row?.score ?? view.scores.find((s) => s.k === k)?.score ?? null;
      const detail = [
        k === lastK ? 'Last iteration' : 'Restores its workspace checkpoint',
        row?.outcome ? reasonLabel(row.outcome) : null,
        score !== null ? `score ${score}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        label: `Accept iteration ${k + 1}`,
        detail,
        onPress: () => {
          setPickOpen(false);
          send({ command: 'accept_iteration', instanceId, k });
        },
      };
    });

  return (
    <Animated.View entering={entering} className="gap-3 rounded-3xl border border-warning bg-warning-muted p-4">
      <View className="gap-1">
        <Text className="text-sm font-semibold text-warning">Loop needs your decision</Text>
        <Text className="text-md font-semibold text-foreground">{name}</Text>
      </View>
      <Text className="text-sm leading-relaxed text-foreground">{decisionHeadline(view)}</Text>
      <Text className="text-sm text-muted-foreground">
        {`${view.iterations} ${view.iterations === 1 ? 'iteration' : 'iterations'} finished`}
        {max !== null ? ` of ${max}` : ''}
        {spend.length > 0 ? ` · ${spend.join(' · ')}` : ''}
      </Text>

      {canControl ? (
        <View className="gap-2">
          <View className="flex-row gap-2">
            <Button
              label="Grant +1"
              grow
              size="lg"
              haptic="commit"
              loading={busy}
              disabled={busy}
              onPress={() => send({ command: 'grant_iterations', instanceId, n: 1 })}
            />
            <Button
              label="Grant +2"
              variant="secondary"
              size="lg"
              disabled={busy}
              onPress={() => send({ command: 'grant_iterations', instanceId, n: 2 })}
            />
          </View>
          <Button label="Continue with input" variant="secondary" full disabled={busy} onPress={() => setInputOpen(true)} />
          <View className="flex-row gap-2">
            <Button
              label="Accept"
              variant="secondary"
              grow
              disabled={busy || lastK < 0}
              accessibilityHint="Completes the loop with its last iteration"
              onPress={() => send({ command: 'accept', instanceId })}
            />
            <Button
              label="Accept iteration…"
              variant="secondary"
              grow
              disabled={busy || lastK < 0}
              onPress={() => setPickOpen(true)}
            />
          </View>
          <View className="flex-row flex-wrap gap-x-2">
            <Button label="Raise budget" variant="ghost" size="sm" disabled={busy} onPress={() => setBudgetOpen(true)} />
            <Button label="Fail loop" variant="ghost" size="sm" disabled={busy} onPress={() => setConfirmFail(true)} />
          </View>
        </View>
      ) : (
        <View className="flex-row items-center gap-3">
          <Lock size={16} color={colors['muted-foreground']} />
          <Text className="flex-1 text-sm text-muted-foreground">Deciding for a loop needs workflow permission on this device.</Text>
          {onRequestAccess ? <Button label="Request access" variant="secondary" size="sm" onPress={onRequestAccess} /> : null}
        </View>
      )}

      <FeedbackSheet
        visible={inputOpen}
        onClose={() => setInputOpen(false)}
        title="Continue with input"
        message={`The next iteration of "${name}" starts with this message.`}
        placeholder="What should the next iteration do?"
        submitLabel="Continue"
        required
        busy={busy}
        onSubmit={(text) => {
          setInputOpen(false);
          send({ command: 'continue_with_input', instanceId, text });
        }}
      />

      <ActionSheet
        visible={pickOpen}
        onClose={() => setPickOpen(false)}
        title="Accept which iteration?"
        message="The loop completes with that iteration's output. An earlier one is available only when its workspace was checkpointed."
        actions={pickActions}
      />

      <RaiseBudgetSheet
        visible={budgetOpen}
        onClose={() => setBudgetOpen(false)}
        busy={busy}
        onSubmit={(fields) => {
          setBudgetOpen(false);
          send({ command: 'raise_budget', instanceId, ...fields });
        }}
      />

      <ActionSheet
        visible={confirmFail}
        onClose={() => setConfirmFail(false)}
        title={`Fail "${name}"?`}
        message="The loop fails and every stage after it is blocked. This cannot be undone."
        actions={[
          {
            label: 'Fail loop',
            destructive: true,
            onPress: () => {
              setConfirmFail(false);
              send({ command: 'fail', instanceId });
            },
          },
        ]}
      />
    </Animated.View>
  );
}

type BudgetFields = Omit<Extract<LoopCommand, { command: 'raise_budget' }>, 'command' | 'instanceId' | 'expectedVersion'>;

/** Parses a positive number, or null when the field is blank or not one. */
function positive(text: string, integer: boolean): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return integer ? Math.round(n) : n;
}

function RaiseBudgetSheet({
  visible,
  onClose,
  busy,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  busy: boolean;
  onSubmit: (fields: BudgetFields) => void;
}): React.ReactElement {
  const [turns, setTurns] = useState('');
  const [cost, setCost] = useState('');
  const [tokens, setTokens] = useState('');
  const [minutes, setMinutes] = useState('');

  useEffect(() => {
    if (!visible) return;
    setTurns('');
    setCost('');
    setTokens('');
    setMinutes('');
  }, [visible]);

  const fields: BudgetFields = {};
  const t = positive(turns, true);
  const c = positive(cost, false);
  const k = positive(tokens, true);
  const m = positive(minutes, false);
  if (t !== null) fields.maxTurns = t;
  if (c !== null) fields.maxCostUsd = c;
  if (k !== null) fields.maxTokens = k;
  if (m !== null) fields.maxWallClockMs = Math.max(1000, Math.round(m * 60_000));
  const empty = Object.keys(fields).length === 0;

  return (
    <Sheet visible={visible} onClose={onClose} title="Raise budget" detents={[0.75, 0.92]}>
      <View className="gap-3 px-4 pb-6 pt-2">
        <Text className="text-sm leading-relaxed text-muted-foreground">
          Amounts are added to the loop's budget. Fill in only what ran out.
        </Text>
        <Field label="Turns" value={turns} onChangeText={setTurns} keyboardType="number-pad" placeholder="e.g. 20" />
        <Field label="Cost (USD)" value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="e.g. 2.50" />
        <Field label="Tokens" value={tokens} onChangeText={setTokens} keyboardType="number-pad" placeholder="e.g. 200000" />
        <Field label="Wall clock (minutes)" value={minutes} onChangeText={setMinutes} keyboardType="decimal-pad" placeholder="e.g. 30" />
        <Button
          label="Raise budget"
          full
          size="lg"
          haptic="commit"
          loading={busy}
          disabled={empty || busy}
          onPress={() => onSubmit(fields)}
        />
      </View>
    </Sheet>
  );
}

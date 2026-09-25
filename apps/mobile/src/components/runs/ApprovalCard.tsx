// ────────────────────────────────────────────────────────────────
// ApprovalCard — a stage parked on a human decision.
//
// Only for `awaiting_input` (see `awaitsApproval`). Three outcomes, matching
// the approve route exactly, with the parts that were missing on the phone:
//   • the question itself (read from `interruptData`, not a field the server
//     never sends),
//   • feedback text for "Request changes" (without it the agent re-runs blind),
//   • a confirmation on Reject, which fails the stage and blocks the run.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { ApprovalOutcome, StageRunSummary } from '@generatorai/client-core';

import { interruptOf } from './runModel';
import { FeedbackSheet } from './FeedbackSheet';
import { Button } from '../ui/Button';
import { ActionSheet } from '../ui/ActionSheet';
import { useCardEntering } from '../common/enterMotion';

export function ApprovalCard({
  stage,
  interruptData,
  busy,
  onDecide,
  onOpenStage,
}: {
  stage: StageRunSummary;
  /** From pending-interrupts when present; the stage row's own copy otherwise. */
  interruptData: unknown;
  busy: boolean;
  onDecide: (outcome: ApprovalOutcome, feedback?: string) => void;
  onOpenStage?: () => void;
}): React.ReactElement {
  const entering = useCardEntering();
  const view = interruptOf(interruptData ?? stage.interruptData);
  const [feedback, setFeedback] = useState<'changes' | 'approve' | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const name = stage.name ?? stage.stageKey;

  return (
    <Animated.View entering={entering} className="gap-3 rounded-3xl border border-warning bg-warning-muted p-4">
      <View className="gap-1">
        <Text className="text-sm font-semibold text-warning">Needs your decision</Text>
        <Text className="text-md font-semibold text-foreground">{name}</Text>
      </View>
      <Text className="text-sm leading-relaxed text-foreground">{view.reason}</Text>
      {view.summary ? (
        <Text numberOfLines={6} className="text-sm leading-relaxed text-muted-foreground">
          {view.summary}
        </Text>
      ) : null}
      {view.tool ? <Text className="font-mono text-sm text-muted-foreground">Tool: {view.tool}</Text> : null}

      <View className="gap-2">
        <Button
          label="Approve"
          full
          size="lg"
          haptic="commit"
          loading={busy}
          disabled={busy}
          onPress={() => onDecide('approved')}
        />
        <View className="flex-row gap-2">
          <Button
            label="Request changes"
            variant="secondary"
            grow
            disabled={busy}
            onPress={() => setFeedback('changes')}
          />
          <Button label="Reject" variant="secondary" disabled={busy} onPress={() => setConfirmReject(true)} />
        </View>
        <View className="flex-row flex-wrap gap-x-2">
          <Button label="Approve with note" variant="ghost" size="sm" disabled={busy} onPress={() => setFeedback('approve')} />
          {onOpenStage ? (
            <Button label="Open transcript" variant="ghost" size="sm" onPress={onOpenStage} />
          ) : null}
        </View>
      </View>

      <FeedbackSheet
        visible={feedback !== null}
        onClose={() => setFeedback(null)}
        title={feedback === 'changes' ? 'Request changes' : 'Approve with follow-up'}
        message={
          feedback === 'changes'
            ? `Tell the agent what to change in "${name}". It keeps working and asks again.`
            : 'Optional instruction the stage acts on after approval.'
        }
        placeholder={feedback === 'changes' ? 'What should change?' : 'e.g. also handle the empty-input case'}
        submitLabel={feedback === 'changes' ? 'Send feedback' : 'Approve'}
        required={feedback === 'changes'}
        busy={busy}
        onSubmit={(text) => {
          const outcome: ApprovalOutcome = feedback === 'changes' ? 'changes_requested' : 'approved';
          setFeedback(null);
          onDecide(outcome, text || undefined);
        }}
      />

      <ActionSheet
        visible={confirmReject}
        onClose={() => setConfirmReject(false)}
        title={`Reject "${name}"?`}
        message="The stage fails and every stage after it is blocked. This cannot be undone."
        actions={[
          {
            label: 'Reject stage',
            destructive: true,
            onPress: () => {
              setConfirmReject(false);
              onDecide('rejected');
            },
          },
        ]}
      />
    </Animated.View>
  );
}

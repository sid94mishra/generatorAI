// ────────────────────────────────────────────────────────────────
// ApprovalCard — a stage parked on a human decision.
//
// Only for `awaiting_input` (see `awaitsApproval`). Three outcomes, matching
// the approve route exactly, with the parts that were missing on the phone:
//   • the question itself (read from `interruptData`, not a field the server
//     never sends),
//   • feedback text for "Request changes" (without it the agent re-runs blind),
//   • a confirmation on Reject, which fails the stage and blocks the run.
// It is the COMPLETION REVIEW's card: a tool permission, question or plan
// inside a turn renders as the chat's card (`StageGateCard`). There is no
// "approve with a note" (PD-9): a follow-up is a message to the stage.
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
  busy,
  onDecide,
  onOpenStage,
}: {
  /** An `awaiting_input` stage run; its `interruptData` is what the gate asks. */
  stage: StageRunSummary;
  busy: boolean;
  onDecide: (outcome: ApprovalOutcome, feedback?: string) => void;
  onOpenStage?: () => void;
}): React.ReactElement {
  const entering = useCardEntering();
  const view = interruptOf(stage.interruptData);
  const [feedback, setFeedback] = useState(false);
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
            onPress={() => setFeedback(true)}
          />
          <Button label="Reject" variant="secondary" disabled={busy} onPress={() => setConfirmReject(true)} />
        </View>
        {onOpenStage ? (
          <View className="flex-row flex-wrap gap-x-2">
            <Button label="Open transcript" variant="ghost" size="sm" onPress={onOpenStage} />
          </View>
        ) : null}
      </View>

      <FeedbackSheet
        visible={feedback}
        onClose={() => setFeedback(false)}
        title="Request changes"
        message={`Tell the agent what to change in "${name}". It keeps working and asks again.`}
        placeholder="What should change?"
        submitLabel="Send feedback"
        required
        busy={busy}
        onSubmit={(text) => {
          setFeedback(false);
          onDecide('changes_requested', text || undefined);
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

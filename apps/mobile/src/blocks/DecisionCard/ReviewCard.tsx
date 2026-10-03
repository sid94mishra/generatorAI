// MB-34 ReviewCard (03 MB-34; MD-50, MD-31; MWorkflowRun, MRunStageChat, MRunApproval): a stage parked on a completion
// review in the gate shell — "Review <stage>" with the round; the summary; the facts; optionally the reviewer's
// question and a feedback field ("sent with Request changes"); actions Reject (destructive) · Request changes ·
// Approve (the one primary). Every workflow approval is risky (MD-31) and signed with the approval key, so the row
// carries "<Face ID> required", or registration first; `compact` (run screen, chat card) replaces the actions
// with one "Review" that opens the approval sheet (MB-50, the one approval surface, MD-21).
import React, { useState } from 'react';
import { View } from 'react-native';

import { ActionRow, type RowAction } from '../../ui/layout/ActionRow';
import { Button } from '../../ui/primitives/Button';
import { Field } from '../../ui/primitives/Field';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { GateCardFrame } from '../GateCard/GateCardFrame';
import { riskyActionState } from '../GateCard/model/gateModel';
import type { GateApproval } from '../GateCard/PermissionCard';
import type { ReviewView } from './model/reviewModel';

export type ReviewOutcome = 'approved' | 'changes_requested' | 'rejected';

export interface ReviewCardProps {
  view: ReviewView;
  /** "Bug Fixer" — names the feedback field. */
  agent?: string | null;
  /** Full card (sheet, stage chat): the decision; resolves once the server confirmed. */
  onDecide?: (outcome: ReviewOutcome, feedback?: string) => Promise<void>;
  /** The signing state (always risky for a workflow approval). */
  approval?: GateApproval;
  /** Compact card: one "Review" that opens the approval sheet. */
  onReview?: () => void;
  /** Allow changes (the definition's `approval.allowChanges`, default true). */
  allowChanges?: boolean;
  disabledReason?: string;
  testID?: string;
}

export function ReviewCard({ view, agent, onDecide, approval, onReview, allowChanges = true, disabledReason, testID = 'review-card' }: ReviewCardProps): React.ReactElement {
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState<ReviewOutcome | null>(null);
  const risk = approval ? riskyActionState(approval.readiness, approval.noun) : null;
  const decide = (outcome: ReviewOutcome): void => {
    if (!onDecide) return;
    setPending(outcome);
    void onDecide(outcome, feedback.trim() || undefined)
      .then(() => setFeedback(''))
      .catch(() => undefined)
      .finally(() => setPending(null));
  };
  const blocked = Boolean(disabledReason) || pending !== null;
  let actions: RowAction[];
  if (risk?.needsRegistration) {
    actions = [{ id: 'register', label: 'Register approval key', role: 'primary', icon: 'key', loading: approval?.registering === true, onPress: () => approval?.onRegister(), testID: 'review-register' }];
  } else {
    const off = blocked || (risk ? !risk.canAnswer : false);
    actions = [
      { id: 'reject', label: 'Reject', role: 'danger', onPress: () => decide('rejected'), disabled: off, loading: pending === 'rejected', testID: 'review-reject' },
      ...(allowChanges
        ? [{ id: 'changes', label: 'Request changes', role: 'secondary' as const, onPress: () => decide('changes_requested'), disabled: off || !feedback.trim(), ...(feedback.trim() ? {} : { disabledReason: 'Write the changes you want first' }), loading: pending === 'changes_requested', testID: 'review-changes' }]
        : []),
      { id: 'approve', label: 'Approve', role: 'primary', onPress: () => decide('approved'), disabled: off, loading: pending === 'approved', ...(disabledReason ? { disabledReason } : {}), testID: 'review-approve' },
    ];
  }
  return (
    <GateCardFrame title={view.title} meta={view.round} testID={testID}>
      <Text role="body" selectable numberOfLines={onReview ? 4 : undefined}>
        {view.summary}
      </Text>
      {view.facts.length ? (
        <Text role="footnote" tone="fg-3">
          {view.facts.join(' · ')}
        </Text>
      ) : null}
      {view.question && !onReview ? (
        <Text role="footnote" tone="fg-2">
          {view.question}
        </Text>
      ) : null}
      {onReview ? (
        <Button label="Review" variant="primary" icon="hand" fullWidth onPress={onReview} testID={`${testID}-open`} />
      ) : (
        <View className="gap-3">
          {allowChanges ? (
            <Field help="Sent with Request changes">
              <Textarea label={agent ? `Feedback for ${agent}` : 'Feedback'} value={feedback} onChangeText={setFeedback} minRows={2} placeholder="What should change?" testID="review-feedback" />
            </Field>
          ) : null}
          <ActionRow actions={actions} {...(risk ? { note: approval?.error ?? risk.note } : disabledReason ? { note: disabledReason } : {})} />
        </View>
      )}
    </GateCardFrame>
  );
}

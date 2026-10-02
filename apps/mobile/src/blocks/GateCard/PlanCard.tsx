// MB-15 plan gate: the plan's title and summary with "Review plan" (the pane's Plan tab), then GATE_ACTIONS.plan —
// Request changes (secondary → feedback + Send feedback / Cancel) · Approve & implement (primary); "Approve & run
// autonomously" only when the server offers `implement_autopilot`.
import React, { useState } from 'react';
import { PLAN_GATE_COPY } from '@generatorai/shared/ui-contract';

import { ActionRow, type RowAction } from '../../ui/layout/ActionRow';
import { Link } from '../../ui/primitives/Link';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { GateCardFrame } from './GateCardFrame';

export interface PlanGate {
  planId: string;
  title: string;
  summary: string;
  status: string;
  /** Server action ids (`implement_interactive`, `implement_autopilot`, `request_changes`, …). */
  actions: readonly string[];
  revision?: number;
}

export interface PlanCardProps {
  plan: PlanGate;
  onOpenPlan?: () => void;
  /** `actionId` is the server's (passed through `toPlanDecision`); resolves when the server confirmed. */
  onDecide: (actionId: string, feedback?: string) => Promise<void>;
}

export function PlanCard({ plan, onOpenPlan, onDecide }: PlanCardProps): React.ReactElement {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const autopilot = plan.actions.some((a) => /autopilot/i.test(a));
  const expired = plan.status === 'expired' || plan.status === 'superseded';

  const decide = (actionId: string, note?: string): void => {
    if (busy) return;
    setBusy(actionId);
    void onDecide(actionId, note)
      .then(() => setFeedbackOpen(false))
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };

  const actions: RowAction[] = feedbackOpen
    ? [
        { id: 'cancel_feedback', label: PLAN_GATE_COPY.actions.cancel_feedback, role: 'quiet', onPress: () => setFeedbackOpen(false), testID: 'gate-plan-cancel_feedback' },
        { id: 'send_feedback', label: PLAN_GATE_COPY.actions.send_feedback, role: 'primary', loading: busy === 'request_changes', disabled: busy !== null || !feedback.trim(), onPress: () => decide('request_changes', feedback.trim()), testID: 'gate-plan-send_feedback' },
      ]
    : [
        { id: 'request_changes', label: PLAN_GATE_COPY.actions.request_changes, role: 'secondary', disabled: busy !== null, onPress: () => setFeedbackOpen(true), testID: 'gate-plan-request_changes' },
        ...(autopilot
          ? [{ id: 'approve_autopilot', label: PLAN_GATE_COPY.actions.approve_autopilot, role: 'secondary' as const, loading: busy === 'implement_autopilot', disabled: busy !== null, onPress: () => decide('implement_autopilot'), testID: 'gate-plan-approve_autopilot' }]
          : []),
        { id: 'approve', label: PLAN_GATE_COPY.actions.approve, role: 'primary', loading: busy === 'implement_interactive', disabled: busy !== null, onPress: () => decide('implement_interactive'), testID: 'gate-plan-approve' },
      ];

  return (
    <GateCardFrame title={PLAN_GATE_COPY.title} meta={plan.revision && plan.revision > 1 ? PLAN_GATE_COPY.revision(plan.revision) : null} expired={expired}>
      <Text role="subhead" weight={600}>
        {plan.title}
      </Text>
      {plan.summary ? (
        <Text role="footnote" tone="fg-2" numberOfLines={6}>
          {plan.summary}
        </Text>
      ) : null}
      {onOpenPlan ? <Link label={PLAN_GATE_COPY.actions.open_plan} onPress={onOpenPlan} standalone testID="gate-plan-open_plan" /> : null}
      {feedbackOpen ? (
        <Textarea label={PLAN_GATE_COPY.feedbackLabel} value={feedback} onChangeText={setFeedback} placeholder={PLAN_GATE_COPY.feedbackPlaceholder} autoFocus testID="gate-plan-feedback" />
      ) : null}
      {expired ? null : <ActionRow actions={actions} {...(autopilot && !feedbackOpen ? { note: PLAN_GATE_COPY.autopilotHint } : {})} />}
    </GateCardFrame>
  );
}

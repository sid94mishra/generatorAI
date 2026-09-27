// ────────────────────────────────────────────────────────────────
// StageGateCard — a stage parked on a human decision, as the chat shows it.
//
// A tool permission, a question and a plan review inside a stage's turn are
// the chat's gates (P03b): the same PermissionCard / QuestionCard / PlanCard,
// answered through the stage conversation API. Deny and "request changes"
// let the turn carry on with the refusal; they never fail the stage. The
// completion review keeps the ApprovalCard (the `approve` command).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { ApprovalOutcome, StageRunSummary } from '@generatorai/client-core';

import { useStageConversation } from '../../api/useStageConversation';
import { PermissionCard } from '../chat/PermissionCard';
import { PlanCard } from '../chat/PlanCard';
import { QuestionCard } from '../chat/QuestionCard';
import { toPlanDecision } from '../chat/gateActions';
import { ApprovalCard } from './ApprovalCard';
import { stageGateOf } from './stageGate';

export function StageGateCard({
  runId,
  stage,
  busy,
  onDecide,
  onOpenStage,
}: {
  runId: string;
  /** An `awaiting_input` stage run. */
  stage: StageRunSummary;
  /** The completion review's approve command is in flight. */
  busy: boolean;
  /** The completion review's decision (the `approve` command). */
  onDecide: (outcome: ApprovalOutcome, feedback?: string) => void;
  /** The stage screen: its transcript holds the plan and the turn so far. */
  onOpenStage?: (() => void) | undefined;
}): React.ReactElement {
  const conversation = useStageConversation(runId, stage.id);
  const gate = stageGateOf(stage.interruptData);

  switch (gate.kind) {
    case 'permission':
      return (
        <PermissionCard
          block={gate.block}
          onDecide={async (behavior, message) => {
            await conversation.permission.mutateAsync({
              interactionId: gate.interactionId,
              behavior,
              ...(message ? { message } : {}),
            });
          }}
        />
      );
    case 'question':
      return (
        <QuestionCard
          block={gate.block}
          onSubmit={async (answers, freeform) => {
            await conversation.answer.mutateAsync({
              interactionId: gate.interactionId,
              answers,
              ...(freeform ? { freeformResponse: freeform } : {}),
            });
          }}
        />
      );
    case 'plan':
      return (
        <PlanCard
          plan={gate.plan}
          busy={conversation.plan.isPending}
          onOpenPlan={() => onOpenStage?.()}
          onDecide={async (action, feedback) => {
            await conversation.plan.mutateAsync({ interactionId: gate.interactionId, ...toPlanDecision(action, feedback) });
          }}
        />
      );
    default:
      return (
        <ApprovalCard
          stage={stage}
          busy={busy}
          onDecide={onDecide}
          {...(onOpenStage ? { onOpenStage } : {})}
        />
      );
  }
}

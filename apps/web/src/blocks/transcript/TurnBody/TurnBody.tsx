// ────────────────────────────────────────────────────────────────
// TurnBody — the body of one agent response (B-24's rail of B-16…B-23):
// reasoning pills, step rails, prose, gate cards, widgets and the commit card
// in the exact order the agent produced them (`deriveSegments`).
//
// Shared by every surface that shows an agent at work: the chat transcript
// (history and the live turn), the workflow stage body (a stage is a compact
// chat) and the Tasks dock's "Last steps". Pure: the surface supplies click-
// throughs, gate handlers and host slots through the transcript context.
// ────────────────────────────────────────────────────────────────

import { memo, useMemo } from 'react';
import { countTimelineSteps, type StreamSegment, type TimelineStep, type UsageInfo } from '@generatorai/client-core';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';
import { cn } from '@/ui/lib/cn.js';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton.js';
import { WorkingIndicator } from '@/ui/primitives/WorkingIndicator/WorkingIndicator.js';
import { AssistantText } from '../AssistantText/AssistantText.js';
import { InlineError } from '../InlineError/InlineError.js';
import { PermissionCard } from '../gates/PermissionCard.js';
import { PlanReadyCard } from '../gates/PlanReadyCard.js';
import { QuestionCard } from '../gates/QuestionCard.js';
import { StepList } from '../StepRow/StepList.js';
import { ThoughtPill } from '../ThoughtPill/ThoughtPill.js';
import { UsageChip } from '../UsageChip/UsageChip.js';
import { useTranscriptActions } from '../transcriptContext.js';
import { UserMessage } from '../UserMessage/UserMessage.js';
import { segmentCardRenderer } from './segmentCards.js';

export interface TurnBodyProps {
  /** Ordered segments (`deriveSegments(blocks)`). The primary input. */
  segments?: readonly StreamSegment[] | undefined;
  /** Without segments: the steps and answer of a split view (a persisted stage). */
  steps?: readonly TimelineStep[] | undefined;
  answer?: string | undefined;
  /** The turn is live (streaming or parked on a gate). */
  active?: boolean;
  /** Answer tokens are arriving (caret on the last answer). Default: `active`. */
  answerStreaming?: boolean;
  /** Tokens are expected but none have arrived yet. */
  loading?: boolean;
  /** Turn-level error text. */
  error?: string | null | undefined;
  /** Usage line under the body (surfaces without an agent header). */
  usage?: UsageInfo | undefined;
  prevUsage?: UsageInfo | null | undefined;
  prevCompletedAt?: number | null | undefined;
  /** Stream key scoping the usage cache ledger. */
  streamKey?: string | undefined;
  className?: string;
}

function fromSplit(steps: readonly TimelineStep[] | undefined, answer: string | undefined): StreamSegment[] {
  const out: StreamSegment[] = [];
  if (steps && steps.length > 0) out.push({ type: 'steps', id: 'steps-split', steps: [...steps] });
  if (answer) out.push({ type: 'answer', id: 'answer-split', text: answer });
  return out;
}

/** What Summary mode keeps of a turn: gates still waiting on the person, then the latest answer. */
function summarySegments(list: readonly StreamSegment[]): StreamSegment[] {
  let last: StreamSegment | undefined;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]!.type === 'answer') {
      last = list[i];
      break;
    }
  }
  const out = list.filter(
    (s) =>
      (s.type === 'plan' && s.plan.status === 'awaiting_review') ||
      (s.type === 'question' && s.question.status === 'pending') ||
      (s.type === 'permission' && s.permission.status === 'pending'),
  );
  if (last) out.push(last);
  return out;
}

function TurnBodyImpl({
  segments,
  steps,
  answer,
  active = false,
  answerStreaming,
  loading = false,
  error,
  usage,
  prevUsage,
  prevCompletedAt,
  streamKey,
  className,
}: TurnBodyProps) {
  const ctx = useTranscriptActions();
  const mode = ctx.viewMode === 'verbose' ? 'verbose' : 'normal';
  const summary = ctx.viewMode === 'summary';
  const all = segments && segments.length > 0 ? segments : fromSplit(steps, answer);
  const streaming = answerStreaming ?? active;
  // Summary (G-06) condenses a live turn as it does a settled one: the latest
  // answer and one "Working · N steps" line — but a gate waiting on the person
  // is never hidden.
  const stepCount = useMemo(
    () => (summary ? countTimelineSteps(all.flatMap((s) => (s.type === 'steps' ? s.steps : []))).steps : 0),
    [summary, all],
  );
  const list = useMemo(() => (summary ? summarySegments(all) : all), [summary, all]);

  let lastAnswer = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]!.type === 'answer') {
      lastAnswer = i;
      break;
    }
  }
  // A turn parked on a gate waits on the USER: no "generating" cues then.
  const awaitingUser = list.some(
    (s) =>
      (s.type === 'plan' && s.plan.status === 'awaiting_review') ||
      (s.type === 'question' && s.question.status === 'pending') ||
      (s.type === 'permission' && s.permission.status === 'pending'),
  );

  if (list.length === 0 && !loading && !error && !usage && !active) return null;

  return (
    // `data-gai-live`: blocks that appear while the turn streams ease in (D-152).
    <div className={cn('flex min-w-0 flex-col gap-2.5', className)} data-gai-live={active || undefined}>
      {list.map((seg, i) => {
        switch (seg.type) {
          case 'thinking':
            return <ThoughtPill key={seg.id} text={seg.text} live={seg.live && active} defaultOpen={mode === 'verbose'} />;
          case 'steps':
            return <StepList key={seg.id} steps={seg.steps} mode={mode} live={active} />;
          case 'answer':
            return (
              <AssistantText key={seg.id} text={seg.text} streaming={streaming && !awaitingUser && i === lastAnswer} />
            );
          case 'widget':
            return ctx.renderWidget ? (
              <div key={seg.id} className="min-w-0" data-gai-block="widget">
                {ctx.renderWidget(seg.widget)}
              </div>
            ) : null;
          case 'plan':
            return (
              <PlanReadyCard
                key={seg.id}
                plan={seg.plan}
                onOpen={ctx.onOpenPlan}
                onApprove={ctx.onApprovePlan}
                onRequestChanges={ctx.onRequestPlanChanges}
                busy={ctx.gateBusy ?? false}
              />
            );
          case 'question':
            return (
              <QuestionCard key={seg.id} question={seg.question} onSubmit={ctx.onAnswerQuestion} busy={ctx.gateBusy ?? false} />
            );
          case 'permission':
            return (
              <PermissionCard
                key={seg.id}
                permission={seg.permission}
                onAnswer={ctx.onAnswerPermission}
                rememberScope={ctx.permissionScope}
                busy={ctx.gateBusy ?? false}
              />
            );
          case 'scm_result':
            return ctx.renderScmResult ? (
              <div key={seg.id} className="min-w-0" data-gai-block="scm">
                {ctx.renderScmResult(seg.scmResult)}
              </div>
            ) : null;
          case 'operator':
            // A message an operator sent into a stage, or the person's reply to a plan revision (labelled).
            return <UserMessage key={seg.id} content={seg.text} {...(seg.label ? { label: { text: seg.label, icon: 'plan' } } : {})} />;
          case 'workflow_run': {
            const render = segmentCardRenderer('workflow_run');
            return render ? (
              <div key={seg.id} className="min-w-0" data-gai-block="workflow-run">
                {render(seg, ctx)}
              </div>
            ) : null;
          }
          case 'workflow_draft': {
            const render = segmentCardRenderer('workflow_draft');
            return render ? (
              <div key={seg.id} className="min-w-0" data-gai-block="workflow-draft">
                {render(seg, ctx)}
              </div>
            ) : null;
          }
        }
      })}

      {loading && lastAnswer === -1 && !awaitingUser ? (
        <div className="flex flex-col gap-2 pt-1" aria-hidden>
          <Skeleton width="92%" />
          <Skeleton width="78%" />
          <Skeleton width="54%" />
        </div>
      ) : null}

      {/* While the answer itself is streaming its caret shows the activity; a spinner row under
          moving text only travelled down with every line (D-91). */}
      {active && !awaitingUser && (summary || !(streaming && lastAnswer === list.length - 1)) ? (
        <WorkingIndicator aria-label={TRANSCRIPT_COPY.generating} label={TRANSCRIPT_COPY.workingSteps(summary ? stepCount : 0)} />
      ) : null}

      {error ? <InlineError message={error} /> : null}

      {usage ? <UsageChip usage={usage} prevUsage={prevUsage} prevCompletedAt={prevCompletedAt} scopeId={streamKey} /> : null}
    </div>
  );
}

/** One agent response's body, in the order it happened. */
export const TurnBody = memo(TurnBodyImpl);

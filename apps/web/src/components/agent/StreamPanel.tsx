// ────────────────────────────────────────────────────────────────
// StreamPanel — THE shared streaming conversation body.
//
// Extracted 1:1 from the expanded stage body in StageTimelineItem so
// workflow stages and chat assistant turns render identically:
//
//   ● tool call: read foo.ts            (StepRow activity timeline)
//   ● Thinking about …
//   <streaming markdown answer + caret>
//   [error box]
//   [usage chip]
//
// Purely presentational — no store reads. Callers derive the inputs
// with deriveStreamView(blocks) / deriveTimeline + deriveAnswer.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';
import { IncrementalMarkdown } from '@/components/chat/IncrementalMarkdown.js'; // P0-47
import { StepRow, StepGroupRow } from '@/components/agent/StepRow.js';
import { groupSteps } from '@/components/agent/groupSteps.js';
import { UsageChip } from '@/components/agent/UsageChip.js';
import { WidgetFrame } from '@/components/widgets/WidgetFrame.js';
import { PlanCard } from '@/components/chat/PlanCard.js';
import { QuestionCard } from '@/components/chat/QuestionCard.js';
import { PermissionCard } from '@/components/chat/PermissionCard.js';
import type { StreamBlock } from '@/stores/streamStore.js';
import type { StreamSegment } from '@/components/agent/deriveTimeline.js';
import type { TimelineStep, UsageInfo } from '@/components/chat/redesign/types.js';
import { StreamActionsContext, type StreamActions } from '@/components/agent/streamActions.js';

export interface StreamPanelProps {
  /**
   * Ordered conversation segments (steps ↔ answer ↔ inline widget) in the
   * exact temporal order the agent emitted them. When provided this is the
   * primary render path — it keeps prose between tool calls in sequence
   * instead of clubbing all text below the timeline. Callers derive it via
   * `deriveSegments(blocks)` / `deriveStreamView(blocks).segments`.
   *
   * When omitted, the panel falls back to the legacy split view built from
   * `steps` + `answer`.
   */
  segments?: StreamSegment[];
  /** Activity timeline steps (thinking / tool calls / subagents / errors). */
  steps: TimelineStep[];
  /** The assistant's markdown answer (may be empty while streaming). */
  answer: string;
  /**
   * Widget blocks rendered inline below the answer. Only widgets whose
   * `surface === 'inline'` are drawn here — the parent surfaces full-page
   * `widget` instances in the RightPane Widget tab. Empty by default.
   */
  widgets?: Array<Extract<StreamBlock, { type: 'widget' }>>;
  /**
   * Session id that owns the widget instances rendered inline. Required
   * when `widgets` contains inline entries so the WidgetBridge can route
   * postMessage traffic correctly.
   */
  streamKey?: string;
  /** True while answer tokens are still arriving — renders the caret. */
  answerStreaming?: boolean;
  /** True while the turn is active overall (streaming OR parked, e.g.
   *  HITL await). Controls the stream-container class and aria-busy.
   *  Defaults to `answerStreaming`. */
  active?: boolean;
  /** Show the shimmer skeleton in place of the answer when no answer
   *  text has arrived yet. */
  loading?: boolean;
  /** Token usage footer chip (omit to render it elsewhere, as the
   *  stage chips row does). */
  usage?: UsageInfo;
  /**
   * W30: Previous turn's usage — enables the cache-miss notice.
   * Pass the usage from the turn that immediately preceded this one so
   * `computeCacheMiss` can compare expected vs actual cache reads.
   * Optional: when absent the cache-miss badge is suppressed (safe).
   */
  prevUsage?: UsageInfo | null;
  /**
   * W30: Epoch ms when the previous turn completed — used to attribute
   * a cache miss to "idle > 5 min" vs "model changed".
   */
  prevCompletedAt?: number | null;
  /** Error text — rendered in a danger box below the answer. */
  error?: string | null;
  className?: string;
  /**
   * PLN-01 — handlers for the interactive plan / question cards. Omit them to
   * render the transcript read-only (e.g. workflow stage output).
   */
  onOpenPlan?: (planId: string) => void;
  onApprovePlan?: (planId: string, action: 'implement_interactive' | 'implement_autopilot') => void;
  onRequestPlanChanges?: (planId: string, feedback: string) => void;
  onAnswerQuestion?: (
    interactionId: string,
    answers: Record<string, string[]>,
    freeformResponse?: string,
  ) => void;
  /** Review finding 5.1 — allow/deny a blocking tool-permission prompt. */
  onAnswerPermission?: (
    interactionId: string,
    behavior: 'allow' | 'deny',
    message?: string,
  ) => void;
  /** True while a plan/question/permission decision request is in flight. */
  planBusy?: boolean;
  /** Open the Changes tab (optionally at one file). Enables the per-op diff
   *  icons on file-op steps. The conversation-wide list of changed files
   *  lives on the composer (ChatChangesTray), not in the transcript. */
  onOpenChanges?: (filePath?: string) => void;
  /** Open the terminal's agent-command console at one shell call. */
  onOpenShell?: (callId: string) => void;
  /** Workspace behind this transcript — resolves agent screenshot previews. */
  workspaceId?: string;
}

export function StreamPanel({
  segments, steps, answer, widgets, streamKey, answerStreaming = false, active, loading = false,
  usage, prevUsage, prevCompletedAt, error, className,
  onOpenPlan, onApprovePlan, onRequestPlanChanges, onAnswerQuestion, onAnswerPermission, planBusy,
  onOpenChanges, onOpenShell, workspaceId,
}: StreamPanelProps) {
  const isActive = active ?? answerStreaming;
  const showAnswer = !!answer || loading;
  const inlineWidgets = (widgets ?? []).filter((w) => w.surface === 'inline');
  const streamActions = React.useMemo<StreamActions>(
    () => ({
      ...(onOpenChanges ? { onOpenChanges } : {}),
      ...(onOpenShell ? { onOpenShell } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    }),
    [onOpenChanges, onOpenShell, workspaceId],
  );

  // ── Temporal-order render path ──────────────────────────────────
  // When ordered segments are supplied, render them in sequence so prose
  // the agent emits between tool calls stays interleaved with the activity
  // timeline instead of being clubbed together below it.
  if (segments && segments.length > 0) {
    const lastAnswerIdx = (() => {
      for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i]!.type === 'answer') return i;
      }
      return -1;
    })();
    const hasAnswerSeg = lastAnswerIdx !== -1;

    // A turn parked on a plan/question gate is waiting on the USER. Showing
    // "generating" cues there reads as "more output is coming, hold on" and
    // stops people from acting on the card that is already in front of them.
    const awaitingUser = segments.some(
      (s) =>
        (s.type === 'plan' && s.plan.status === 'awaiting_review') ||
        (s.type === 'question' && s.question.status === 'pending') ||
        (s.type === 'permission' && s.permission.status === 'pending'),
    );

    return (
      <StreamActionsContext.Provider value={streamActions}>
      <div className={cn('space-y-2.5', className)}>
        {segments.map((seg, i) => {
          if (seg.type === 'steps') {
            return <StepsTimeline key={seg.id} steps={seg.steps} />;
          }
          if (seg.type === 'answer') {
            const isLastAnswer = i === lastAnswerIdx;
            const streamingHere = isActive && !awaitingUser && isLastAnswer;
            return (
              <div
                key={seg.id}
                className={cn(
                  'min-w-0 overflow-hidden text-[13.5px] leading-relaxed message-assistant',
                  streamingHere && 'stream-container',
                )}
                aria-live="polite"
                aria-busy={streamingHere}
              >
                {/* P0-47: use block-level memoised renderer while streaming;
                    fall back to plain MarkdownRenderer for completed history. */}
                {streamingHere
                  ? <IncrementalMarkdown content={seg.text} />
                  : <MarkdownRenderer content={seg.text} />}
              </div>
            );
          }
          if (seg.type === 'widget' && streamKey) {
            return <WidgetFrame key={seg.id} block={seg.widget} sessionId={streamKey} />;
          }
          // PLN-01 — interactive cards render where the agent produced them,
          // so the transcript reads research → questions → plan → implementation.
          //
          // The cards render whether or not handlers are supplied: history
          // replay (AssistantMessage) has no handlers, but a past plan/question
          // must still appear in the transcript. PlanCard/QuestionCard hide
          // their action rows when the matching callback is absent.
          if (seg.type === 'plan') {
            return (
              <PlanCard
                key={seg.id}
                plan={seg.plan}
                {...(onOpenPlan ? { onOpen: onOpenPlan } : {})}
                {...(onApprovePlan ? { onApprove: onApprovePlan } : {})}
                {...(onRequestPlanChanges ? { onRequestChanges: onRequestPlanChanges } : {})}
                busy={planBusy ?? false}
              />
            );
          }
          if (seg.type === 'question') {
            return (
              <QuestionCard
                key={seg.id}
                question={seg.question}
                {...(onAnswerQuestion ? { onSubmit: onAnswerQuestion } : {})}
                busy={planBusy ?? false}
              />
            );
          }
          if (seg.type === 'permission') {
            return (
              <PermissionCard
                key={seg.id}
                permission={seg.permission}
                {...(onAnswerPermission ? { onAnswer: onAnswerPermission } : {})}
                busy={planBusy ?? false}
              />
            );
          }
          return null;
        })}

        {/* Trailing loading placeholder — only when we expect answer tokens
            but none have arrived yet (no answer segment present). */}
        {loading && !hasAnswerSeg && !awaitingUser && (
          <div className="min-w-0 space-y-2 pt-1">
            <div className="skeleton-shimmer h-3.5 w-[92%] rounded" />
            <div className="skeleton-shimmer h-3.5 w-[78%] rounded" />
            <div className="skeleton-shimmer h-3.5 w-[54%] rounded" />
          </div>
        )}

        {/* Streaming activity indicator — always rendered at the tail of the
            content while the turn is active, so the "generating" cue never
            appears mid-stream (e.g. stranded on an earlier answer segment
            once tool calls follow it). */}
        {isActive && !awaitingUser && <StreamingIndicator />}

        {/* Error box */}
        {error && (
          <div className="rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/[0.06] px-3 py-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-danger)]" />
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-[var(--color-danger)]/85">{error}</pre>
            </div>
          </div>
        )}

        {/* Usage footer — W30: prevUsage enables the cache-miss notice, and
            streamKey scopes its sticky `reportedCache` ledger. */}
        {usage && (
          <UsageChip
            usage={usage}
            prevUsage={prevUsage}
            prevCompletedAt={prevCompletedAt}
            scopeId={streamKey}
          />
        )}
      </div>
      </StreamActionsContext.Provider>
    );
  }

  // Nothing to draw — return null so parent space-y stacks don't get a
  // phantom gap from an empty wrapper div.
  if (steps.length === 0 && !showAnswer && !error && !usage && inlineWidgets.length === 0) return null;

  return (
    <StreamActionsContext.Provider value={streamActions}>
    <div className={cn('space-y-2.5', className)}>
      {/* Tool calls / activity — connected vertical timeline */}
      {steps.length > 0 && <StepsTimeline steps={steps} />}

      {/* Streaming answer — inline markdown, no "Answer" header.
          min-w-0 + overflow-hidden ensures long code blocks inside
          MarkdownRenderer scroll internally instead of blowing out
          the parent column. */}
      {showAnswer && (
        <div
          className={cn(
            'min-w-0 overflow-hidden text-[13.5px] leading-relaxed message-assistant',
            isActive && 'stream-container',
          )}
          aria-live="polite"
          aria-busy={isActive}
        >
          {answer ? (
            <>
              {/* P0-47: incremental memoised render while streaming */}
              {answerStreaming
                ? <IncrementalMarkdown content={answer} />
                : <MarkdownRenderer content={answer} />}
              {answerStreaming && <StreamingIndicator className="mt-1" />}
            </>
          ) : (
            // Empty streaming placeholder — shown only when the caller
            // says tokens are expected (`loading`), never while parked
            // in HITL where a shimmer would be misleading.
            <div className="space-y-2 pt-1">
              <div className="skeleton-shimmer h-3.5 w-[92%] rounded" />
              <div className="skeleton-shimmer h-3.5 w-[78%] rounded" />
              <div className="skeleton-shimmer h-3.5 w-[54%] rounded" />
            </div>
          )}
        </div>
      )}

      {/* Inline widgets — rendered below the answer.
          Full-page `widget` surfaces are drawn elsewhere by the page's
          RightPane. */}
      {inlineWidgets.length > 0 && streamKey && (
        <div className="space-y-2">
          {inlineWidgets.map((w) => (
            <WidgetFrame key={w.instanceId} block={w} sessionId={streamKey} />
          ))}
        </div>
      )}

      {/* Error box */}
      {error && (
        <div className="rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/[0.06] px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-danger)]" />
            <pre className="whitespace-pre-wrap font-mono text-[11px] text-[var(--color-danger)]/85">{error}</pre>
          </div>
        </div>
      )}

      {/* Usage footer */}
      {usage && (
        <UsageChip
          usage={usage}
          prevUsage={prevUsage}
          prevCompletedAt={prevCompletedAt}
          scopeId={streamKey}
        />
      )}
    </div>
    </StreamActionsContext.Provider>
  );
}

/** Connected vertical activity timeline for a run of steps. Shared by the
 *  legacy split view and each `steps` segment in the temporal-order path. */
function StepsTimeline({ steps }: { steps: TimelineStep[] }) {
  // Runs of related tool calls collapse to one row each (see groupSteps), so
  // an eight-file read costs the reader one line, not eight.
  const entries = React.useMemo(() => groupSteps(steps), [steps]);
  return (
    <div className="relative">
      {/* connector line through center of each step dot (x=16px) */}
      <div className="pointer-events-none absolute left-[16px] top-3 bottom-3 w-px bg-[var(--color-border)]" aria-hidden />
      <div className="space-y-0">
        {entries.map((entry) =>
          entry.type === 'group'
            ? <StepGroupRow key={entry.id} group={entry} />
            : <StepRow key={entry.step.id} step={entry.step} />,
        )}
      </div>
    </div>
  );
}

/** Polished "generating" indicator — three staggered bouncing gradient dots.
 *  Rendered at the tail of the stream while a turn is active so the activity
 *  cue always sits at the end of the content (never stranded mid-stream). */
function StreamingIndicator({ className }: { className?: string }) {
  return (
    <div
      className={cn('streaming-indicator', className)}
      role="status"
      aria-label="Generating"
    >
      <span className="stream-dot" />
      <span className="stream-dot" />
      <span className="stream-dot" />
    </div>
  );
}

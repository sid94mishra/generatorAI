// ────────────────────────────────────────────────────────────────
// StreamingMessage — Live streaming display for the current turn.
// Renders through the shared StreamPanel so the live turn looks
// identical to persisted history (AssistantMessage) and to workflow
// stage bodies (StageTimelineItem):
//   stream.blocks → deriveStreamView → <StreamPanel>
//
// Thinking, tool calls, sub-agents and errors become StepRow timeline
// entries; text blocks become the markdown answer with a streaming
// caret. The initial-loading skeleton (before any block arrives) is
// preserved from the previous implementation.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import type { StreamState } from '@/stores/streamStore.js';
import type { UsageInfo } from '@/components/chat/redesign/types.js';
import { StreamPanel } from '@/components/agent/StreamPanel.js';
import { deriveStreamView } from '@/components/agent/deriveTimeline.js';
import { Loader2 } from 'lucide-react';

interface StreamingMessageProps {
  stream: StreamState;
  /** Session (aka stream key) that owns any widget instances drawn
   *  inline — required for the widget bridge to route postMessage
   *  traffic. Falls back to no session (widgets won't be interactive). */
  sessionId?: string;
  /**
   * W30: Previous turn's usage — passed through to StreamPanel → UsageChip
   * to enable the cache-miss notice. When absent, the badge is suppressed.
   */
  prevUsage?: UsageInfo | null;
  /**
   * W30: Epoch ms when the previous turn completed — used to attribute a
   * cache miss to "idle > 5 min" vs "model changed".
   */
  prevCompletedAt?: number | null;
  /** PLN-01 — handlers for the interactive plan / question cards. */
  onOpenPlan?: (planId: string) => void;
  onApprovePlan?: (planId: string, action: 'implement_interactive' | 'implement_autopilot') => void;
  onRequestPlanChanges?: (planId: string, feedback: string) => void;
  onAnswerQuestion?: (
    interactionId: string,
    answers: Record<string, string[]>,
    freeformResponse?: string,
  ) => void;
  planBusy?: boolean;
}

export function StreamingMessage({
  stream,
  sessionId,
  prevUsage,
  prevCompletedAt,
  onOpenPlan,
  onApprovePlan,
  onRequestPlanChanges,
  onAnswerQuestion,
  planBusy,
}: StreamingMessageProps) {
  const isActive = stream.status === 'streaming' || stream.status === 'thinking';
  const hasContent = stream.blocks.length > 0;

  const view = useMemo(
    () => deriveStreamView(stream.blocks, { active: isActive }),
    [stream.blocks, isActive],
  );

  // Usage chip — shown after completion. W30: preserve all usage fields so
  // UsageChip can display cacheReadTokens, cost, and the cache-miss notice.
  const usage: UsageInfo | undefined = useMemo(() => {
    if (!stream.usage || stream.status !== 'complete') return undefined;
    return {
      model: stream.usage.model,
      inputTokens: stream.usage.inputTokens,
      outputTokens: stream.usage.outputTokens,
      durationMs: stream.usage.durationMs ?? 0,
      cacheReadTokens: stream.usage.cacheReadTokens,
      cacheWriteTokens: stream.usage.cacheWriteTokens,
      cost: stream.usage.cost,
      provider: stream.usage.provider,
    };
  }, [stream.usage, stream.status]);

  if (!hasContent && !isActive) return null;

  return (
    <div>
      {hasContent && (
        <StreamPanel
          segments={view.segments}
          steps={view.steps}
          answer={view.answer}
          widgets={view.widgets}
          streamKey={sessionId}
          active={isActive}
          answerStreaming={stream.status === 'streaming'}
          loading={isActive && view.steps.length === 0}
          usage={usage}
          prevUsage={prevUsage}
          prevCompletedAt={prevCompletedAt}
          {...(onOpenPlan ? { onOpenPlan } : {})}
          {...(onApprovePlan ? { onApprovePlan } : {})}
          {...(onRequestPlanChanges ? { onRequestPlanChanges } : {})}
          {...(onAnswerQuestion ? { onAnswerQuestion } : {})}
          planBusy={planBusy ?? false}
        />
      )}

      {/* Initial loading state — spinner + shimmer skeleton with contextual text */}
      {!hasContent && isActive && (
        <div className="animate-block-in mt-4">
          <div className="flex gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
            <div className="flex-1 space-y-3 pt-1">
              {/* Status indicator with spinner */}
              <div className="flex items-center gap-2.5">
                <div className="flex gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[var(--color-primary)] dot-pulse-1" />
                  <span className="h-2 w-2 rounded-full bg-[var(--color-primary)] dot-pulse-2" />
                  <span className="h-2 w-2 rounded-full bg-[var(--color-primary)] dot-pulse-3" />
                </div>
                <span className="text-sm font-medium text-[var(--color-foreground)]">
                  {stream.status === 'thinking' ? 'Analyzing your request...' : 'Generating response...'}
                </span>
              </div>
              {/* Shimmer skeleton lines */}
              <div className="space-y-2.5 max-w-lg">
                <div className="skeleton-shimmer h-3.5 w-[85%] rounded-md" />
                <div className="skeleton-shimmer h-3.5 w-[70%] rounded-md" />
                <div className="skeleton-shimmer h-3.5 w-[55%] rounded-md" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

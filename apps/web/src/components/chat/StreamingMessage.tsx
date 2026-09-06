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

import React, { useCallback, useMemo } from 'react';
import type { StreamState } from '@/stores/streamStore.js';
import type { UsageInfo } from '@/components/chat/redesign/types.js';
import { StreamPanel } from '@/components/agent/StreamPanel.js';
import { deriveStreamView } from '@/components/agent/deriveTimeline.js';
import { useTextToSpeech } from '@/hooks/useTextToSpeech.js';
import { toast } from '@/components/Toast.js';
import { AudioLines, Square, CircleSlash } from 'lucide-react';
import { Button, Spinner } from '@/components/ui/index.js';
import { READ_ALOUD_ENABLED } from '@/components/chat/featureFlags.js';
import { ThinkingPlaceholder } from '@/components/chat/ThinkingPlaceholder.js';

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
  /** Review finding 5.1 — allow/deny a blocking tool-permission prompt. */
  onAnswerPermission?: (
    interactionId: string,
    behavior: 'allow' | 'deny',
    message?: string,
  ) => void;
  planBusy?: boolean;
  /** Click-throughs for per-op diff icons / shell console / summary card. */
  onOpenChanges?: (filePath?: string) => void;
  onOpenShell?: (callId: string) => void;
  /** Workspace behind this chat — resolves agent screenshot previews. */
  workspaceId?: string;
}

export function StreamingMessage({
  stream,
  sessionId,
  prevUsage,
  prevCompletedAt,
  onOpenPlan,
  onOpenChanges,
  onOpenShell,
  onApprovePlan,
  onRequestPlanChanges,
  onAnswerQuestion,
  onAnswerPermission,
  planBusy,
  workspaceId,
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

  // Phase 4 (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E) — "the agent
  // talks while it works." Unlike AssistantMessage's Phase 3 button, which
  // reads a FINISHED message, this streams the turn's `harness.token` events
  // straight into synthesis, so speech starts on the first complete sentence
  // instead of after the last one. `sessionId` (not the chat id) is the
  // EventBus channel — see useTextToSpeech's `speakStream` doc.
  const {
    isSupported: ttsSupported,
    status: ttsStatus,
    speakStream,
    stop: stopSpeaking,
  } = useTextToSpeech({
    onError: (msg) => toast({ variant: 'error', title: 'Speak live', description: msg }),
  });
  const isSpeakingOrConnecting = ttsStatus === 'speaking' || ttsStatus === 'connecting';
  const handleSpeakLive = useCallback(() => {
    if (isSpeakingOrConnecting) {
      stopSpeaking();
      return;
    }
    if (sessionId) void speakStream(sessionId);
  }, [isSpeakingOrConnecting, stopSpeaking, speakStream, sessionId]);

  const stopped = stream.cancelRequested && !isActive;
  if (!hasContent && !isActive && !stopped) return null;

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
          {...(onOpenChanges ? { onOpenChanges } : {})}
          {...(onOpenShell ? { onOpenShell } : {})}
          {...(workspaceId ? { workspaceId } : {})}
          {...(onApprovePlan ? { onApprovePlan } : {})}
          {...(onRequestPlanChanges ? { onRequestPlanChanges } : {})}
          {...(onAnswerQuestion ? { onAnswerQuestion } : {})}
          {...(onAnswerPermission ? { onAnswerPermission } : {})}
          planBusy={planBusy ?? false}
        />
      )}

      {/* The user stopped this turn. Mirrors AssistantMessage's persisted
          marker so a stopped turn is never a silent gap in the transcript —
          including one stopped before it produced a single block. */}
      {stopped && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)]" data-testid="stream-stopped-note">
          <CircleSlash className="h-3 w-3" />
          {hasContent ? 'Stopped before the response finished.' : 'Stopped before the agent responded.'}
        </p>
      )}

      {/* Speak this turn aloud AS IT GENERATES (Phase 4). Only offered while
          the turn is actually live — once it completes, AssistantMessage's
          "Read aloud" is the right control for the finished text. */}
      {READ_ALOUD_ENABLED && isActive && ttsSupported && sessionId && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleSpeakLive}
          className="mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition-colors"
          title={isSpeakingOrConnecting ? 'Stop speaking' : 'Speak this response aloud as it is written'}
          aria-label={isSpeakingOrConnecting ? 'Stop speaking' : 'Speak this response aloud as it is written'}
        >
          {ttsStatus === 'connecting' ? (
            <Spinner size="sm" />
          ) : ttsStatus === 'speaking' ? (
            <Square className="h-3.5 w-3.5" />
          ) : (
            <AudioLines className="h-3.5 w-3.5" />
          )}
          {isSpeakingOrConnecting ? 'Stop' : 'Speak live'}
        </Button>
      )}

      {/* Initial loading state — the one shared placeholder (also used by
          ChatPage for the pending-turn gap), so the cue never changes shape
          between "sent" and "first block". */}
      {!hasContent && isActive && (
        <ThinkingPlaceholder label={stream.status === 'thinking' ? 'Analyzing your request' : 'Generating response'} />
      )}
    </div>
  );
}

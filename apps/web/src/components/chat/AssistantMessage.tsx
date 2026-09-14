// ────────────────────────────────────────────────────────────────
// AssistantMessage — Renders a persisted assistant response (history).
// Renders through the shared StreamPanel so a turn looks identical
// whether it is streaming live (StreamingMessage), replayed from chat
// history, or shown inside a workflow stage (StageTimelineItem):
//   ChatMessage → chatMessageToBlocks → deriveStreamView → <StreamPanel>
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo } from 'react';
import type { ChatMessage } from '@generatorai/shared';
import { Bot, CircleSlash, Volume2, Square } from 'lucide-react';
import { StreamPanel } from '@/components/agent/StreamPanel.js';
import { chatMessageToBlocks } from '@/components/agent/chatMessageToBlocks.js';
import { deriveStreamView } from '@/components/agent/deriveTimeline.js';
import { useTextToSpeech } from '@/hooks/useTextToSpeech.js';
import { toast } from '@/components/Toast.js';
import { Button, Spinner } from '@/components/ui/index.js';
import { READ_ALOUD_ENABLED } from '@/components/chat/featureFlags.js';
import { AttachmentChips } from '@/components/chat/AttachmentChips.js';
import { MessageActions } from '@/components/chat/MessageActions.js';

interface AssistantMessageProps {
  message: ChatMessage;
  /** Show the avatar + "Assistant" header row. Off by default so the chat
   *  response matches the headerless workflow-stage stream (StreamPanel only). */
  showHeader?: boolean;
  /**
   * Opens a plan in the right-pane Plan tab.
   *
   * History has no live gate, so no approve/reject handlers are passed — but a
   * past plan must still be READABLE, and the Plan tab loads from the server
   * rather than from stream state. Omit to render the card inert.
   */
  onOpenPlan?: (planId: string) => void;
  /** Click-throughs for per-op diff icons / shell console / summary card. */
  onOpenChanges?: (filePath?: string) => void;
  onOpenShell?: (callId: string) => void;
  /** Workspace behind this chat — resolves agent screenshot previews. */
  workspaceId?: string;
  /** Owning chat — gates "Ask the agent" on a conflicting `scm_result`. */
  chatId?: string;
  /**
   * The newest response in the transcript. Its action bar is shown without a
   * hover, because it is the one people act on — and on touch there is no
   * hover to reveal any of them with.
   */
  isLatest?: boolean;
}

export function AssistantMessage({ message, showHeader = false, onOpenPlan, onOpenChanges, onOpenShell, workspaceId, chatId, isLatest = false }: AssistantMessageProps) {
  // Persisted history is never active — sub-agent steps resolve to done.
  const view = useMemo(
    () => deriveStreamView(chatMessageToBlocks(message), { active: false }),
    [message],
  );

  // Phase 3 (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E) — "read this
  // message aloud." `view.answer` is the same flattened plain-text string
  // StreamPanel renders, so what plays back always matches what's on screen.
  const {
    isSupported: ttsSupported,
    status: ttsStatus,
    speak,
    stop: stopSpeaking,
  } = useTextToSpeech({
    onError: (msg) => toast({ variant: 'error', title: 'Read aloud', description: msg }),
  });
  const isSpeakingOrConnecting = ttsStatus === 'speaking' || ttsStatus === 'connecting';
  const handleReadAloud = useCallback(() => {
    if (isSpeakingOrConnecting) {
      stopSpeaking();
      return;
    }
    void speak(view.answer);
  }, [isSpeakingOrConnecting, stopSpeaking, speak, view.answer]);

  return (
    <div className={showHeader ? 'group flex gap-3' : 'group'}>
      {/* Avatar — only shown when showHeader is true */}
      {showHeader && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-sm">
          <Bot className="h-4 w-4" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        {showHeader && (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-foreground)]">Assistant</span>
            <span className="text-[11px] text-[var(--color-muted-foreground)]">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          </div>
        )}

        <StreamPanel
          segments={view.segments}
          steps={view.steps}
          answer={view.answer}
          widgets={view.widgets}
          streamKey={message.sessionId}
          {...(onOpenPlan ? { onOpenPlan } : {})}
          {...(onOpenChanges ? { onOpenChanges } : {})}
          {...(onOpenShell ? { onOpenShell } : {})}
          {...(workspaceId ? { workspaceId } : {})}
          {...(chatId ? { chatId } : {})}
        />

        {/* Copy the conversation / branch it from this response. Rendered
            before "Read aloud" so the two sit on the same row. */}
        <div className="flex flex-wrap items-center gap-1">
          {message.chatId && (
            <MessageActions
              chatId={message.chatId}
              turnId={message.metadata?.turnId}
              alwaysVisible={isLatest}
            />
          )}

        {/* Read this message aloud (Phase 3) — only offered once there's
            actual answer text and the platform supports playback. */}
        {READ_ALOUD_ENABLED && ttsSupported && view.answer.trim() && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReadAloud}
            className="mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition-colors"
            title={isSpeakingOrConnecting ? 'Stop reading' : 'Read this message aloud'}
            aria-label={isSpeakingOrConnecting ? 'Stop reading' : 'Read this message aloud'}
          >
            {ttsStatus === 'connecting' ? (
              <Spinner size="sm" />
            ) : ttsStatus === 'speaking' ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" />
            )}
            {isSpeakingOrConnecting ? 'Stop' : 'Read aloud'}
          </Button>
        )}
        </div>

        {/* A stopped turn keeps everything it streamed, so say that it is not
            the whole answer rather than letting it read as one. */}
        {message.metadata?.partial && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)]" data-testid="message-stopped-note">
            <CircleSlash className="h-3 w-3" />
            {/* Same wording as the live stream (StreamingMessage). */}
            {view.answer.trim() || view.steps.length > 0 || view.segments.length > 0
              ? 'Stopped before the response finished.'
              : 'Stopped before the agent responded.'}
          </p>
        )}

        {/* Attachments (generated artifacts) */}
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentChips attachments={message.attachments} chatId={message.chatId} className="mt-2.5" download />
        )}
      </div>
    </div>
  );
}

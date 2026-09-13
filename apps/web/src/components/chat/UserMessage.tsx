// ────────────────────────────────────────────────────────────────
// UserMessage — Renders a user chat message.
// Layout is kept consistent with the workflow stage prompt bubble
// (StageTimelineItem): a right-aligned bubble with a small header,
// no avatar column, so chat and workflow-run streams look identical.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { ChatMessage } from '@generatorai/shared';
import { User } from 'lucide-react';
import { AttachmentChips } from '@/components/chat/AttachmentChips.js';
import { RewindMenu } from '@/components/chat/RewindMenu.js';

interface UserMessageProps {
  message: ChatMessage;
  /**
   * May this turn be rewound right now? False while a turn is in flight —
   * the server answers 409 CHAT_BUSY, so the control says why instead of
   * letting the user discover it by pressing.
   *
   * Rewinding TO the first turn is valid (it empties the conversation), so
   * position in the transcript is deliberately not a condition.
   */
  canRewind?: boolean;
  /** Workspace behind this chat — lets a file rewind invalidate its queries. */
  workspaceId?: string | undefined;
}

export function UserMessage({ message, canRewind = false, workspaceId }: UserMessageProps) {
  const chatId = message.chatId;
  const turnId = message.metadata?.turnId;
  return (
    <div className="group flex items-start justify-end gap-1.5">
      {/* Rewind lives at the bubble's outer edge, revealed on hover (and
          always present on touch, which has no hover to reveal it with). */}
      {chatId && turnId && (
        <RewindMenu
          chatId={chatId}
          turnId={turnId}
          workspaceId={workspaceId}
          canRewind={canRewind}
          className="mt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
        />
      )}
      <div className="max-w-[85%] min-w-0">
        {/* Right-aligned prompt bubble — mirrors the workflow "Stage prompt". */}
        <div className="rounded-2xl rounded-br-sm border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/[0.08] px-3.5 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary)]/80">
            <User className="h-2.5 w-2.5" />
            You
            <span className="ml-auto font-normal normal-case tracking-normal text-[var(--color-muted-foreground)]">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-foreground)]/90">
            {message.content}
          </p>
        </div>

        {/* Attachments — hover an image for a preview */}
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentChips attachments={message.attachments} chatId={message.chatId} className="mt-2 justify-end" />
        )}
      </div>
    </div>
  );
}

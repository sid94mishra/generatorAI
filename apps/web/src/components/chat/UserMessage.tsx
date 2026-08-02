// ────────────────────────────────────────────────────────────────
// UserMessage — Renders a user chat message.
// Layout is kept consistent with the workflow stage prompt bubble
// (StageTimelineItem): a right-aligned bubble with a small header,
// no avatar column, so chat and workflow-run streams look identical.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { ChatMessage } from '@generatorai/shared';
import { User, Paperclip } from 'lucide-react';

interface UserMessageProps {
  message: ChatMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex justify-end">
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

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {message.attachments.map((attachment, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-full bg-[var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)]"
              >
                <Paperclip className="h-3 w-3" />
                {attachment.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

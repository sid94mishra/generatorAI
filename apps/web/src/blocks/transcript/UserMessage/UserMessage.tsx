// ────────────────────────────────────────────────────────────────
// B-14 UserMessage — the prompt, as a `raised` card (radius panel, pad 12/14,
// 14/1.6 text) with inline mono for `backticked` spans and attachment chips.
// Hover actions (rewind …) come from the host through `actions` and sit at the
// card's outer edge, revealed on hover/focus and always shown on touch.
//
// States: `pending` (the optimistic bubble of a turn being sent — "just now")
// and sent.
// ────────────────────────────────────────────────────────────────

import { Fragment, type ReactNode } from 'react';
import type { ChatMessage } from '@generatorai/shared';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';
import { cn } from '@/ui/lib/cn.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { AttachmentList } from './AttachmentList.js';
import { formatTurnTime } from '../formatTime.js';

/** `a `b` c` → text with InlineCode spans; an unmatched backtick stays literal. */
export function withInlineCode(text: string): ReactNode {
  const parts = text.split(/(`[^`\n]+`)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
      <InlineCode key={i}>{part.slice(1, -1)}</InlineCode>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export interface UserMessageProps {
  content: string;
  attachments?: ChatMessage['attachments'];
  /** Chat that owns the attachments (their URLs need it). */
  chatId?: string | undefined;
  /** When it was sent; omitted for a pending bubble. */
  timestamp?: Date | string | number;
  /** The optimistic bubble of a turn still being sent. */
  pending?: boolean;
  /** Hover actions (the host's rewind menu …). */
  actions?: ReactNode;
  className?: string;
}

/** A user prompt card. */
export function UserMessage({ content, attachments, chatId, timestamp, pending = false, actions, className }: UserMessageProps) {
  const time = pending
    ? TRANSCRIPT_COPY.justNow
    : timestamp != null
      ? formatTurnTime(timestamp)
      : null;
  return (
    <div className={cn('group relative min-w-0', className)} data-chat-row data-gai-block="user">
      <div className="flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-raised px-3.5 py-3">
        <p className="pr-16 text-body break-words whitespace-pre-wrap text-fg">{withInlineCode(content)}</p>
        {attachments && attachments.length > 0 ? <AttachmentList attachments={attachments} chatId={chatId} /> : null}
      </div>
      <div
        className={cn(
          'absolute top-2 right-2 flex items-center gap-1',
          !pending &&
            'opacity-0 transition-control group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100',
        )}
      >
        {time ? <span className="font-mono text-micro text-fg-3">{time}</span> : null}
        {actions}
      </div>
    </div>
  );
}

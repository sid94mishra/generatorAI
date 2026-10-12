// ────────────────────────────────────────────────────────────────
// B-14 UserMessage — the prompt, as a `raised` card (radius panel, pad 12/14,
// 14/1.6 text) with inline mono for `backticked` spans and attachment chips.
// Hover actions (rewind …) come from the host through `actions` and sit at the
// card's outer edge, revealed on hover/focus and always shown on touch.
//
// States: `pending` (the optimistic bubble of a turn being sent — "just now")
// and sent.
// ────────────────────────────────────────────────────────────────

import { Fragment, useState, type ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import type { ChatMessage } from '@generatorai/shared';
import { TRANSCRIPT_COPY, parseReviewPrompt, type ParsedReviewPrompt } from '@generatorai/shared/ui-contract';
import { cn } from '@/ui/lib/cn.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Icon } from '@/ui/icons/Icon.js';
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
  /** What sent it when no person typed it (a workflow's stage prompt, iteration input …). */
  label?: { text: string; icon: IconConcept } | undefined;
  className?: string;
}

/** Past this a message starts clamped (a stage prompt or a pasted log runs to thousands of characters). */
const LONG_CHARS = 1200;
const LONG_LINES = 14;

export function isLongMessage(content: string): boolean {
  if (content.length > LONG_CHARS) return true;
  let lines = 1;
  for (let i = 0; i < content.length; i += 1) if (content.charCodeAt(i) === 10 && ++lines > LONG_LINES) return true;
  return false;
}

/** A user prompt card. */
export function UserMessage({ content, attachments, chatId, timestamp, pending = false, actions, label, className }: UserMessageProps) {
  const long = isLongMessage(content);
  const [expanded, setExpanded] = useState(false);
  const time = pending
    ? TRANSCRIPT_COPY.justNow
    : timestamp != null
      ? formatTurnTime(timestamp)
      : null;
  const review = parseReviewPrompt(content);
  return (
    <div className={cn('group relative min-w-0', className)} data-chat-row data-gai-block="user">
      <div className="flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-raised px-3.5 py-3">
        {label ? (
          <span className="flex items-center gap-1.5 pr-16 text-small text-fg-3" data-testid="user-message-label">
            <Icon concept={label.icon} size={12} />
            {label.text}
          </span>
        ) : null}
        {review ? (
          <ReviewComments review={review} />
        ) : (
          <p
            className={cn('pr-16 text-body break-words whitespace-pre-wrap text-fg', long && !expanded && 'max-h-48 overflow-hidden')}
            {...(long ? { 'data-collapsed': expanded ? 'false' : 'true' } : {})}
          >
            {withInlineCode(content)}
          </p>
        )}
        {long && !review ? (
          <Button size="sm" variant="ghost" className="self-start" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
            {expanded ? TRANSCRIPT_COPY.showLess : TRANSCRIPT_COPY.showMore}
          </Button>
        ) : null}
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

/**
 * A review-comment prompt ("Add & send" from the Changes dock) as the comments the person wrote — not the
 * machine-formatted XML the agent receives.
 */
function ReviewComments({ review }: { review: ParsedReviewPrompt }) {
  const n = review.comments.length;
  return (
    <div className="flex min-w-0 flex-col gap-2 pr-16" data-testid="user-review-comments">
      <p className="flex items-center gap-1.5 text-small text-fg-2">
        <Icon concept="message" size={14} />
        {n === 1 ? 'Review comment' : `${n} review comments`}
      </p>
      <ul className="flex min-w-0 flex-col gap-1.5">
        {review.comments.map((c, i) => (
          <li key={i} className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <InlineCode>{c.lines ? `${c.path}:${c.lines}` : c.path}</InlineCode>
              {c.intent ? <Badge>{c.intent.charAt(0).toUpperCase() + c.intent.slice(1)}</Badge> : null}
            </span>
            <span className="text-body break-words whitespace-pre-wrap text-fg">{c.body}</span>
          </li>
        ))}
      </ul>
      {review.note ? <p className="text-body break-words whitespace-pre-wrap text-fg">{withInlineCode(review.note)}</p> : null}
    </div>
  );
}

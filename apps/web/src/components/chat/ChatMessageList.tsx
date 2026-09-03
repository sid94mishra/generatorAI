// ────────────────────────────────────────────────────────────────
// ChatMessageList — the settled transcript.
//
// ── D8: containment, not windowing ───────────────────────────────
// This used to switch to `@tanstack/react-virtual` above 80 messages:
// absolutely-positioned rows on a `translateY`, with everything outside the
// window absent from the DOM. That is option (a) — the one D8 explicitly did
// not choose. Its recorded reason is worth restating, because the cost is
// invisible in a screenshot and obvious to anyone who relies on it:
//
//   "(c) — containment preserves find-in-page, tab order, selection and the
//    accessibility tree, all of which windowing breaks"
//
// A row that is not in the DOM cannot be found by ⌘F, cannot be reached by
// Tab, cannot be included in a select-all copy of the conversation, and does
// not exist to a screen reader. Above 80 messages every one of those was
// broken, silently, for the sake of a scroll optimisation the browser can do
// itself.
//
// So every message is in the DOM, always, and each row carries
// `content-visibility: auto`. The browser skips layout, paint and style for
// rows outside the viewport — the same saving windowing was after — while
// keeping them in the document, which is what preserves all four properties
// above. `contain-intrinsic-size: auto <estimate>` supplies a placeholder
// height so the scrollbar does not jump, and the `auto` keyword makes the
// browser remember each row's real height once it has been rendered once, so
// the estimate stops mattering after the first pass.
//
// Find-in-page is the one that needs the explicit note: browsers deliberately
// force `content-visibility: auto` subtrees to render when the find bar
// matches inside them, which is exactly why this technique preserves ⌘F and
// windowing cannot.
//
// The streaming message is not rendered here at all — ChatPage renders it
// after this list — so W27's "render the streaming message unvirtualized" is
// structural rather than a special case.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { ChatMessage } from '@generatorai/shared';
import { UserMessage } from './UserMessage.js';
import { AssistantMessage } from './AssistantMessage.js';
import { SystemMessage } from './SystemMessage.js';
import { ToolMessage } from './ToolMessage.js';

interface ChatMessageListProps {
  messages: ChatMessage[];
  /** Opens a plan from a persisted card in the right-pane Plan tab. */
  onOpenPlan?: (planId: string) => void;
  /** Click-throughs for per-op diff icons / shell console / summary card. */
  onOpenChanges?: (filePath?: string) => void;
  onOpenShell?: (callId: string) => void;
  /**
   * External scroll container ref.
   *
   * Kept for call-site compatibility. Containment needs no scroll root — the
   * browser applies it against whatever viewport the row is in — so this is no
   * longer read. It stays because ChatPage passes its page-level scroll ref and
   * removing the prop would be a churn-only change across every call site.
   */
  scrollElementRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Rows below this render with no containment at all.
 *
 * `content-visibility` is not free: it costs a containment context and a
 * resize observation per row. Under a screenful or two of messages the browser
 * was never going to struggle, so paying for it there is a pure loss — the
 * same reasoning the old `VIRTUAL_THRESHOLD` encoded, applied to a mechanism
 * that does not break the document when it engages.
 */
const CONTAINMENT_THRESHOLD = 40;

/**
 * Placeholder height for a row the browser has not measured yet.
 *
 * Only ever wrong once per row: `contain-intrinsic-size: auto` replaces it
 * with the real height as soon as the row has been rendered a single time.
 * Generous on purpose — an underestimate makes the scrollbar grow as the user
 * scrolls, which reads as the page fighting them.
 */
const ESTIMATED_ROW_HEIGHT = '160px';

/**
 * Does this assistant turn have anything to show?
 *
 * Text is the usual answer, but a turn can carry all of its value in
 * metadata: a tool-only turn, or one the user stopped part-way, has thinking
 * and tool calls with no prose. Keying off `content` alone hid those rows
 * entirely, so a stopped turn replayed as just the user's message.
 */
function hasRenderableContent(message: ChatMessage): boolean {
  if (message.content?.trim()) return true;
  const meta = message.metadata;
  if (!meta) return false;
  return Boolean(
    meta.thinkingText?.trim() ||
      meta.toolCalls?.length ||
      meta.planCards?.length ||
      meta.questionCards?.length ||
      meta.widgetInstanceIds?.length ||
      meta.systemMessages?.length,
  );
}

function renderMessage(
  message: ChatMessage,
  onOpenPlan?: (planId: string) => void,
  onOpenChanges?: (filePath?: string) => void,
  onOpenShell?: (callId: string) => void,
): React.ReactNode {
  // System messages are always meaningful and tool messages display
  // toolName/toolArgs rather than content, so only user/assistant rows are
  // subject to the emptiness check.
  if (message.role !== 'system' && message.role !== 'tool' && !hasRenderableContent(message)) {
    return null;
  }

  switch (message.role) {
    case 'user':
      return <UserMessage message={message} />;
    case 'assistant':
      return (
        <AssistantMessage
          message={message}
          {...(onOpenPlan ? { onOpenPlan } : {})}
          {...(onOpenChanges ? { onOpenChanges } : {})}
          {...(onOpenShell ? { onOpenShell } : {})}
        />
      );
    case 'system':
      return <SystemMessage message={message} />;
    case 'tool':
      return <ToolMessage message={message} />;
    default:
      return null;
  }
}

/**
 * One transcript row.
 *
 * `data-chat-row` is the hook the containment CSS and the D8 regression test
 * both key off, so neither can drift from the markup without the other
 * noticing.
 */
const MessageRow = React.memo(function MessageRow({
  message,
  contained,
  onOpenPlan,
  onOpenChanges,
  onOpenShell,
}: {
  message: ChatMessage;
  contained: boolean;
  onOpenPlan?: (planId: string) => void;
  onOpenChanges?: (filePath?: string) => void;
  onOpenShell?: (callId: string) => void;
}) {
  const node = renderMessage(message, onOpenPlan, onOpenChanges, onOpenShell);
  if (!node) return null;
  return (
    <div
      data-chat-row
      style={
        contained
          ? {
              contentVisibility: 'auto',
              containIntrinsicSize: `auto ${ESTIMATED_ROW_HEIGHT}`,
            }
          : undefined
      }
    >
      {node}
    </div>
  );
});

export function ChatMessageList({ messages, onOpenPlan, onOpenChanges, onOpenShell }: ChatMessageListProps) {
  const contained = messages.length > CONTAINMENT_THRESHOLD;
  return (
    <div className="space-y-5">
      {messages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          contained={contained}
          {...(onOpenPlan ? { onOpenPlan } : {})}
          {...(onOpenChanges ? { onOpenChanges } : {})}
          {...(onOpenShell ? { onOpenShell } : {})}
        />
      ))}
    </div>
  );
}

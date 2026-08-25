// ────────────────────────────────────────────────────────────────
// ChatMessageList — Renders list of chat messages.
//
// WEB-01: Virtualization kicks in above VIRTUAL_THRESHOLD messages via
// @tanstack/react-virtual. Below the threshold the DOM is a plain flow
// (cheap, no measurement overhead). The virtualizer uses dynamic row
// measurement because chat messages vary wildly in height (one-line
// user prompt vs. multi-paragraph assistant response with code blocks).
// ────────────────────────────────────────────────────────────────

import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChatMessage } from '@generatorai/shared';
import { UserMessage } from './UserMessage.js';
import { AssistantMessage } from './AssistantMessage.js';
import { SystemMessage } from './SystemMessage.js';
import { ToolMessage } from './ToolMessage.js';

interface ChatMessageListProps {
  messages: ChatMessage[];
  /** Opens a plan from a persisted card in the right-pane Plan tab. */
  onOpenPlan?: (planId: string) => void;
  /**
   * External scroll container ref. When provided, the virtualizer uses this
   * element as its scroll root instead of creating a nested scroll div.
   * Pass the page-level scroll ref (e.g. from useStickToBottom) so there is
   * only ONE scroll container in the hierarchy — two nested scroll areas
   * creates a confusing UX where the inner box fills before the outer page.
   */
  scrollElementRef?: React.RefObject<HTMLElement | null>;
}

/** Threshold above which virtualization turns on.
 *  Below this, a flat list renders faster than virtualization because the
 *  measurement/ResizeObserver overhead isn't amortized yet. */
const VIRTUAL_THRESHOLD = 80;

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
      return <AssistantMessage message={message} {...(onOpenPlan ? { onOpenPlan } : {})} />;
    case 'system':
      return <SystemMessage message={message} />;
    case 'tool':
      return <ToolMessage message={message} />;
    default:
      return null;
  }
}

export function ChatMessageList({ messages, onOpenPlan, scrollElementRef }: ChatMessageListProps) {
  if (messages.length <= VIRTUAL_THRESHOLD) {
    return (
      <div className="space-y-5">
        {messages.map((message) => {
          const node = renderMessage(message, onOpenPlan);
          if (!node) return null;
          return <React.Fragment key={message.id}>{node}</React.Fragment>;
        })}
      </div>
    );
  }

  return (
    <VirtualChatList
      messages={messages}
      scrollElementRef={scrollElementRef}
      {...(onOpenPlan ? { onOpenPlan } : {})}
    />
  );
}

/** Dynamic-height virtualized list for large chat histories. */
function VirtualChatList({
  messages,
  onOpenPlan,
  scrollElementRef,
}: {
  messages: ChatMessage[];
  onOpenPlan?: (planId: string) => void;
  /**
   * External scroll container. When provided the virtualizer attaches to it
   * directly (no nested scroll box). When absent a self-contained scroll div
   * is created as fallback (e.g. when ChatMessageList is used outside ChatPage).
   */
  scrollElementRef?: React.RefObject<HTMLElement | null>;
}) {
  // Fallback inner scroll ref — only used when no outer ref is provided.
  const innerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollElementRef?.current ?? innerRef.current,
    // Rough initial height — re-measured when each row mounts via
    // measureElement below. Keeping this generous avoids a visible reflow
    // on first paint when many rows compute to <200px.
    estimateSize: () => 160,
    overscan: 8,
    // Use the message id as the stable key so scroll position + measurements
    // survive list mutations (e.g., streaming updates inserting mid-list).
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // When using an external scroll container (scrollElementRef provided) we
  // render a plain wrapper — no overflow, no height cap — and let the parent
  // page handle scrolling. When no external ref is provided we fall back to a
  // self-contained scroll div so the component is usable in isolation.
  const inner = (
    <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
      {items.map((item) => {
        const message = messages[item.index];
        if (!message) return null;
        const node = renderMessage(message, onOpenPlan);
        if (!node) return null;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`,
              paddingBottom: '1.25rem',
            }}
          >
            {node}
          </div>
        );
      })}
    </div>
  );

  // External scroll container: no wrapper needed — the total-height div is
  // placed directly in the flow, and the parent div handles overflow.
  if (scrollElementRef) {
    return inner;
  }

  // Fallback: own scroll container so the component is self-contained.
  return (
    <div
      ref={innerRef}
      className="h-[70vh] overflow-y-auto"
      style={{ contain: 'strict' }}
    >
      {inner}
    </div>
  );
}

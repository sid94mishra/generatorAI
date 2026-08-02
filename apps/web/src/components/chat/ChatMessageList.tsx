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
}

/** Threshold above which virtualization turns on.
 *  Below this, a flat list renders faster than virtualization because the
 *  measurement/ResizeObserver overhead isn't amortized yet. */
const VIRTUAL_THRESHOLD = 80;

function renderMessage(
  message: ChatMessage,
  onOpenPlan?: (planId: string) => void,
): React.ReactNode {
  // Skip messages with empty content — these arise when the SDK fires
  // message_complete with no content (e.g., tool-only turns) and an
  // empty string was persisted before the guard was added.
  // System and tool messages are exempt: system messages are always
  // meaningful, and tool messages display toolName/toolArgs, not content.
  if (!message.content?.trim() && message.role !== 'system' && message.role !== 'tool') {
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

export function ChatMessageList({ messages, onOpenPlan }: ChatMessageListProps) {
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

  return <VirtualChatList messages={messages} {...(onOpenPlan ? { onOpenPlan } : {})} />;
}

/** Dynamic-height virtualized list for large chat histories. */
function VirtualChatList({
  messages,
  onOpenPlan,
}: {
  messages: ChatMessage[];
  onOpenPlan?: (planId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
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

  return (
    <div
      ref={parentRef}
      className="max-h-[60vh] overflow-y-auto"
      style={{ contain: 'strict' }}
    >
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
    </div>
  );
}

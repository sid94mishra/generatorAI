// ────────────────────────────────────────────────────────────────
// useChatTranscript — the persisted messages the chat page shows: paging,
// de-duplication against the optimistic bubble, the composer's prompt
// history, stick-to-bottom, and clearing the live stream once history
// catches up.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatMessages } from '@/hooks/queries.js';
import { useStickToBottom } from '@/hooks/useStickToBottom.js';
import { attachmentUrl } from '@/lib/attachmentUrl.js';
import { useStreamStore } from '@/stores/streamStore.js';
import type { ChatStreamState } from './useChatStreamState.js';

/** Messages per page; "Load earlier messages" adds another page. */
export const CHAT_PAGE_SIZE = 100;

/** One prompt the human typed, as the composer's ↑/↓ history recalls it. */
export interface ChatPromptHistoryEntry {
  id: string;
  text: string;
  ts: number;
  attachments: Array<{ name: string; mimeType: string; url: string }>;
}

export function useChatTranscript(
  chatId: string | undefined,
  sessionId: string | undefined,
  stream: Pick<ChatStreamState, 'hasStream' | 'streamStatus' | 'turnUserMessage' | 'serverTurnId' | 'blocksLength'>,
) {
  const { hasStream, streamStatus, turnUserMessage, serverTurnId, blocksLength } = stream;

  // P0-48: start with the most recent page; "Load earlier" raises the limit
  // so the user can page back without fetching the whole corpus at once.
  const [msgLimit, setMsgLimit] = useState(CHAT_PAGE_SIZE);
  const { data: messages, isLoading: messagesLoading } = useChatMessages(chatId, msgLimit);
  // `=== msgLimit`, not `>=`: true only when the server filled the page. This
  // wastes one round-trip when the total is a multiple of the page size, but
  // never loops on "Load earlier" for an exact count.
  const hasMoreMessages = (messages?.length ?? 0) === msgLimit;
  const loadEarlier = useCallback(() => setMsgLimit((prev) => prev + CHAT_PAGE_SIZE), []);

  const isInActiveTurn = hasStream && streamStatus !== 'idle' && !!turnUserMessage;

  const displayMessages = useMemo(() => {
    if (!messages?.length) return messages ?? [];
    if (!isInActiveTurn) return messages;

    // Hide the persisted copy of the message this turn is streaming, so it
    // isn't rendered twice (the optimistic bubble already shows it).
    //
    // Prefer the server-generated turnId (WEB-02): it identifies the current
    // turn's messages exactly. Content matching cannot — if the user repeats a
    // prompt they sent earlier, the scan lands on the OLDER copy and slicing
    // there hides every message after it, so the conversation appears to
    // vanish until the turn ends and this dedup switches off.
    if (serverTurnId) {
      const idx = messages.findIndex(
        (m) => m.role === 'user'
          && (m as { metadata?: { turnId?: string } }).metadata?.turnId === serverTurnId,
      );
      return idx >= 0 ? messages.slice(0, idx) : messages;
    }

    const targetContent = turnUserMessage?.trim();

    if (targetContent) {
      // No turnId yet. Only dedup when the match is the very LAST message —
      // that can only be the copy just persisted for this turn. A match
      // anywhere earlier is an identical older prompt and must be left alone.
      const lastIdx = messages.length - 1;
      const last = messages[lastIdx];
      if (last?.role === 'user' && last.content?.trim() === targetContent) {
        return messages.slice(0, lastIdx);
      }
      return messages;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        return messages.slice(0, i + 1);
      }
    }

    return messages;
  }, [messages, isInActiveTurn, turnUserMessage, serverTurnId]);

  // ↑ / ↓ prompt history for the composer — every prompt the human typed in
  // this chat (widget- and system-originated user rows are not "theirs").
  const promptHistory = useMemo<ChatPromptHistoryEntry[]>(() => {
    const out: ChatPromptHistoryEntry[] = [];
    for (const m of messages ?? []) {
      if (m.role !== 'user') continue;
      const origin = m.metadata?.origin;
      if (origin === 'widget' || origin === 'system') continue;
      if (!m.content?.trim() && !(m.attachments?.length)) continue;
      out.push({
        id: m.id,
        text: m.content,
        ts: new Date(m.timestamp).getTime(),
        attachments: (m.attachments ?? []).flatMap((a) => {
          const url = attachmentUrl(a, m.chatId ?? chatId);
          return url ? [{ name: a.name, mimeType: a.mimeType, url }] : [];
        }),
      });
    }
    return out;
  }, [messages, chatId]);

  const showOptimisticUserMessage = !!turnUserMessage && streamStatus !== 'idle';

  // Stick-to-bottom: auto-follow while pinned near the bottom; surface a
  // "jump to latest" pill when the user scrolls up to read mid-stream.
  //
  // `useStickToBottom` re-binds on this signature and then follows content
  // growth itself via a `ResizeObserver` on the scrolled element — so the
  // signature only needs to change on message-count/block-count/status
  // boundaries, NOT on every streamed token.
  const scrollSignature = `${displayMessages.length}:${blocksLength}:${streamStatus ?? ''}`;
  const { ref: scrollRef, showJumpToLatest, jumpToLatest } = useStickToBottom(scrollSignature);

  // Auto-clear the completed stream once the history catches up. Only matters
  // at the turn-complete boundary, so this keys off `streamStatus` and reads
  // the live blocks from a fresh snapshot rather than subscribing to them.
  useEffect(() => {
    if (streamStatus !== 'complete' || !sessionId) return;
    if (!messages?.length) return;

    const current = useStreamStore.getState().streams[sessionId];
    if (!current || current.status !== 'complete') return;

    // Widgets live only in the event stream (not in chat history), so
    // clearing would drop the inline widget iframes rendered this turn.
    const hasWidgetBlocks = current.blocks.some((b) => b.type === 'widget');
    // Orchestrator workers still running exist only in the stream and outlive
    // the turn that spawned them; `clearStream` would leave the stream `idle`,
    // the one status the transcript does not render.
    const hasLiveWorkers = current.blocks.some(
      (b) => b.type === 'background_task' && (b.status === 'running' || b.status === 'spawned'),
    );
    if (hasWidgetBlocks || hasLiveWorkers) return;

    const turnMsg = current.turnUserMessage?.trim();
    if (!turnMsg) {
      useStreamStore.getState().clearStream(sessionId);
      return;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user' && messages[i]?.content?.trim() === turnMsg) {
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j]?.role === 'assistant') {
            useStreamStore.getState().clearStream(sessionId);
            return;
          }
        }
        return;
      }
    }
  }, [streamStatus, messages, sessionId]);

  return {
    messages,
    messagesLoading,
    hasMoreMessages,
    loadEarlier,
    displayMessages,
    promptHistory,
    showOptimisticUserMessage,
    scrollRef,
    showJumpToLatest,
    jumpToLatest,
  };
}

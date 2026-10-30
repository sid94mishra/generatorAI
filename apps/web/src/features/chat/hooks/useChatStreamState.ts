// ────────────────────────────────────────────────────────────────
// useChatStreamState — the chat page's NARROW view of the live stream.
//
// The per-session stream record is replaced on every streamed token (W27), so
// subscribing to it here re-rendered the whole page ~60x/second during a
// turn. Each selector below returns a PRIMITIVE (or a value — like `usage` —
// that only changes when it genuinely should), so Zustand's default equality
// check skips the re-render unless that specific field changed. The live,
// per-token content (`blocks`, `text`) is read only inside the leaf
// components that render it (LiveTranscript, AgentShellPanel).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { protectStream, useStreamStore } from '@/stores/streamStore.js';

/** The last completed turn's usage, as the next turn's usage chip compares it. */
export interface TurnUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
  /** USD, only from a provider that reports one (`cost` may be a multiplier). */
  costUsd?: number;
  provider?: string;
}

export function useChatStreamState(sessionId: string | undefined) {
  const streamStatus = useStreamStore((state) => (sessionId ? state.streams[sessionId]?.status : undefined));
  const hasStream = useStreamStore((state) => !!sessionId && state.streams[sessionId] != null);
  const turnUserMessage =
    useStreamStore((state) => (sessionId ? state.streams[sessionId]?.turnUserMessage : undefined)) ?? null;
  const pendingUserMessage =
    useStreamStore((state) => (sessionId ? state.streams[sessionId]?.pendingUserMessage : undefined)) ?? null;
  const serverTurnId =
    useStreamStore((state) => (sessionId ? state.streams[sessionId]?.serverTurnId : undefined)) ?? null;
  const blocksLength = useStreamStore((state) => (sessionId ? state.streams[sessionId]?.blocks.length ?? 0 : 0));
  const stoppedByUser = useStreamStore((state) =>
    sessionId ? state.streams[sessionId]?.cancelRequested ?? false : false,
  );
  /**
   * Whether the current turn has produced its OWN content yet (text / tool
   * steps / answer) — anything other than blocks carried across the turn
   * barrier (widgets are preserved from previous turns by startPending). A
   * follow-up prompt in a widget chat still has carried widget blocks, which
   * must NOT suppress the "thinking" indicator.
   */
  const hasNewTurnContent = useStreamStore((state) => {
    if (!sessionId) return false;
    const s = state.streams[sessionId];
    return s != null && s.blocks.some((b) => b.type !== 'widget');
  });
  // Widgets keep the transcript "active" even once the turn itself is idle —
  // the LLM may have rendered one in an earlier turn and it stays live.
  const hasActiveWidgetBlock = useStreamStore((state) => {
    if (!sessionId) return false;
    const s = state.streams[sessionId];
    return s != null && s.blocks.some((b) => b.type === 'widget' && b.surface === 'inline' && b.status !== 'closed');
  });
  // A settled commit / PR / conflict card lives only in the stream and
  // survives the transcript cleanup; it must keep the transcript visible.
  const hasScmResultBlock = useStreamStore((state) => {
    if (!sessionId) return false;
    const s = state.streams[sessionId];
    return s != null && s.blocks.some((b) => b.type === 'scm_result');
  });
  const awaitingPlanId = useStreamStore((state) => {
    const blocks = sessionId ? state.streams[sessionId]?.blocks : undefined;
    if (!blocks) return null;
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const b = blocks[i];
      if (b?.type === 'plan' && b.status === 'awaiting_review') return b.planId;
    }
    return null;
  });
  const lastStreamUsage = useStreamStore((state) => {
    if (!sessionId) return null;
    const s = state.streams[sessionId];
    return s?.status === 'complete' ? (s.usage ?? null) : null;
  });
  /**
   * Lightweight proxies for "a block relevant to THIS effect changed" — text
   * tokens never touch question/plan/permission/full-page-widget blocks, so
   * these stay referentially idle during ordinary streaming even though the
   * underlying `blocks` array is replaced every token.
   */
  const interactionBlocksKey = useStreamStore((state) => {
    const blocks = sessionId ? state.streams[sessionId]?.blocks : undefined;
    if (!blocks) return '';
    let key = '';
    for (const b of blocks) {
      if (b.type === 'question') key += `|q:${b.interactionId}:${b.status}`;
      else if (b.type === 'permission') key += `|p:${b.interactionId}:${b.status}`;
      else if (b.type === 'plan') key += `|pl:${b.planId}:${b.status}:${b.interactionId ?? ''}`;
    }
    return key;
  });
  const widgetSurfaceKey = useStreamStore((state) => {
    const blocks = sessionId ? state.streams[sessionId]?.blocks : undefined;
    if (!blocks) return '';
    let key = '';
    for (const b of blocks) {
      if (b.type === 'widget' && b.surface === 'widget') key += `|${b.instanceId}:${b.status}`;
    }
    return key;
  });
  const widgetTitlesKey = useStreamStore((state) => {
    const blocks = sessionId ? state.streams[sessionId]?.blocks : undefined;
    if (!blocks) return '';
    let key = '';
    for (const b of blocks) {
      if (b.type === 'widget') key += `|${b.instanceId}:${b.title ?? ''}:${b.component}`;
    }
    return key;
  });

  // The stream record is LRU-bounded; exempt the transcript that is on screen
  // so a busy workflow run streaming twenty stages cannot evict the chat the
  // user is actually reading.
  useEffect(() => {
    if (!sessionId) return;
    return protectStream(sessionId);
  }, [sessionId]);

  const isStreaming = streamStatus === 'streaming' || streamStatus === 'thinking';
  const isPending = streamStatus === 'pending';
  const isWorking = isStreaming || isPending;

  // Whether the transcript has anything to show right now — gates both the
  // empty state and whether the live transcript renders anything.
  const showStreamingMessage =
    hasStream &&
    (blocksLength > 0 || stoppedByUser) &&
    (streamStatus !== 'idle' || hasActiveWidgetBlock || hasScmResultBlock);

  // W30: the previous completed turn's usage, for the cache-miss notice. When
  // a turn transitions to 'complete', capture its usage so the NEXT turn's
  // usage chip can compare against it.
  const prevUsageRef = useRef<{ usage: TurnUsage; completedAt: number } | null>(null);
  useEffect(() => {
    if (streamStatus === 'complete' && lastStreamUsage) {
      prevUsageRef.current = {
        usage: {
          model: lastStreamUsage.model,
          inputTokens: lastStreamUsage.inputTokens,
          outputTokens: lastStreamUsage.outputTokens,
          durationMs: lastStreamUsage.durationMs ?? 0,
          cacheReadTokens: lastStreamUsage.cacheReadTokens,
          cacheWriteTokens: lastStreamUsage.cacheWriteTokens,
          cost: lastStreamUsage.cost,
          costUsd: lastStreamUsage.costUsd,
          provider: lastStreamUsage.provider,
        },
        completedAt: Date.now(),
      };
    }
  }, [lastStreamUsage, streamStatus]);

  return {
    streamStatus,
    hasStream,
    turnUserMessage,
    pendingUserMessage,
    serverTurnId,
    blocksLength,
    hasNewTurnContent,
    awaitingPlanId,
    interactionBlocksKey,
    widgetSurfaceKey,
    widgetTitlesKey,
    isStreaming,
    isPending,
    /** A turn is pending or streaming — the composer and every "busy" affordance key off this. */
    isWorking,
    showStreamingMessage,
    prevUsageRef,
  };
}

export type ChatStreamState = ReturnType<typeof useChatStreamState>;

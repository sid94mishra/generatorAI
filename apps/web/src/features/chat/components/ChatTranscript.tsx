// ────────────────────────────────────────────────────────────────
// F-chat-02 TranscriptHost — the chat's transcript on the transcript kit
// (B-24 TranscriptView): persisted turns, the optimistic bubble and the live
// turn, the empty state, paging, stick-to-bottom, view mode (G-06), rewind
// and the response actions.
//
// Render isolation (W27) is kept: the live stream record is replaced on every
// token, and `LiveTurn` below is the ONLY component that subscribes to the
// whole record. Everything else reads the narrow selectors of
// `useChatStreamState` handed down by the page.
// ────────────────────────────────────────────────────────────────

import { memo, useCallback, useDeferredValue, useMemo, useRef, type ReactNode } from 'react';
import {
  buildTranscriptTurns,
  deriveSegments,
  type ScmResultBlock,
  type UsageInfo,
  type WidgetBlock,
} from '@generatorai/client-core';
import type { ChatMessage } from '@generatorai/shared';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';
import { useStreamStore } from '@/stores/streamStore.js';
import { useTranscriptPrefsStore, useTranscriptViewMode } from '@/stores/transcriptPrefsStore.js';
import {
  AgentTurnHeader,
  StoppedNote,
  ThinkingPlaceholder,
  TranscriptProvider,
  TranscriptView,
  TurnBody,
  UsageChip,
  type TranscriptActions,
} from '@/blocks/transcript/index.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import type { ChatView } from '../hooks/useChatView.js';
import { MessageActions } from './MessageActions.js';
import { RewindMenu } from './RewindMenu.js';

export interface ChatTranscriptProps {
  view: ChatView;
  /** Name the agent's responses are signed with. */
  agentName: string;
  /** The harness label for the "… is thinking" placeholder; null when unknown. */
  harnessLabel: string | null;
  canRewind: boolean;
  /** Skeleton while the message page loads. */
  loadingFallback?: ReactNode;
  /** Host slots for blocks rendered by legacy parts until their ports land. */
  renderWidget?: (block: WidgetBlock, sessionId: string) => ReactNode;
  renderScmResult?: (block: ScmResultBlock) => ReactNode;
  /** Focus a dock tab (browser, background tasks). */
  focusDockTab?: (type: 'browser' | 'tasks') => void;
}

/** D-33 fallback: finished turns before the last N start collapsed. */
const TRANSCRIPT_EXPANDED_TURNS = 20;

interface LiveTurnProps {
  sessionId: string;
  agentName: string;
  harnessLabel: string | null;
  prevUsage: UsageInfo | null;
  prevCompletedAt: number | null;
  /** The turn is pending and has produced nothing of its own yet. */
  thinking: boolean;
}

/**
 * The one place that subscribes to the FULL live stream record (W27): a token
 * re-renders this leaf only.
 */
const LiveTurn = memo(function LiveTurn({ sessionId, agentName, harnessLabel, prevUsage, prevCompletedAt, thinking }: LiveTurnProps) {
  const current = useStreamStore((state) => state.streams[sessionId]);
  // The transcript swaps a finished live turn for its persisted message in a
  // deferred render (D-88). The stream is cleared as soon as history holds the
  // turn, which can be a few frames before that render commits: keep showing
  // the finished turn meanwhile instead of an empty gap.
  const lastFinished = useRef<typeof current>(undefined);
  if (current?.status === 'complete' && (current.blocks?.length ?? 0) > 0) lastFinished.current = current;
  else if (current && current.status !== 'idle') lastFinished.current = undefined;
  const cleared = !current || (current.status === 'idle' && (current.blocks?.length ?? 0) === 0);
  const stream = cleared && lastFinished.current ? lastFinished.current : current;
  const status = stream?.status;
  const active = status === 'streaming' || status === 'thinking';
  const blocks = stream?.blocks;
  const segments = useMemo(() => deriveSegments(blocks, { active }), [blocks, active]);
  const hasContent = (blocks?.length ?? 0) > 0;
  const stopped = !!stream?.cancelRequested && !active;
  const usage: UsageInfo | undefined = useMemo(() => {
    const u = stream?.usage;
    if (!u || status !== 'complete') return undefined;
    return {
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      durationMs: u.durationMs ?? 0,
      ...(u.cacheReadTokens != null ? { cacheReadTokens: u.cacheReadTokens } : {}),
      ...(u.cacheWriteTokens != null ? { cacheWriteTokens: u.cacheWriteTokens } : {}),
      ...(u.cost != null ? { cost: u.cost } : {}),
      ...(u.costUsd != null ? { costUsd: u.costUsd } : {}),
      ...(u.provider ? { provider: u.provider } : {}),
    };
  }, [stream?.usage, status]);

  if (!hasContent && !active && !stopped && !thinking) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="live-turn" data-gai-block="live">
      <AgentTurnHeader
        agentName={agentName}
        model={usage?.model}
        streaming={active}
        usage={usage ? <UsageChip usage={usage} prevUsage={prevUsage} prevCompletedAt={prevCompletedAt} scopeId={sessionId} /> : undefined}
      />
      {hasContent ? (
        <TurnBody
          segments={segments}
          active={active}
          answerStreaming={status === 'streaming'}
          loading={active && !segments.some((s) => s.type === 'steps' || s.type === 'answer')}
          streamKey={sessionId}
        />
      ) : null}
      {stopped ? <StoppedNote partial={hasContent} testId="stream-stopped-note" /> : null}
      {!hasContent && (thinking || active) ? (
        <ThinkingPlaceholder label={TRANSCRIPT_COPY.agentThinking(harnessLabel ?? 'Agent')} />
      ) : null}
    </div>
  );
});

/** The chat page's transcript. */
export function ChatTranscript({
  view,
  agentName,
  harnessLabel,
  canRewind,
  loadingFallback,
  renderWidget,
  renderScmResult,
  focusDockTab,
}: ChatTranscriptProps) {
  const { chat, chatId, sessionId, stream, transcript, gates, dock } = { ...view, chatId: view.chat?.id };
  const workspaceId = chat?.workspaceId;
  const { displayMessages, messagesLoading, hasMoreMessages, loadEarlier, showOptimisticUserMessage, scrollRef, showJumpToLatest, jumpToLatest } =
    transcript;
  const viewMode = useTranscriptViewMode(chatId);
  // The segmented control answers the click at once; the transcript re-renders for the new mode in a
  // deferred, interruptible render (D-88), so a long transcript never blocks the frame after the click.
  const renderedViewMode = useDeferredValue(viewMode);
  const setViewMode = useTranscriptPrefsStore((s) => s.setViewMode);

  const thinking = stream.isPending && !stream.hasNewTurnContent;
  const live = stream.showStreamingMessage || thinking;
  const turns = useMemo(
    () =>
      buildTranscriptTurns(displayMessages, {
        pendingUserText: showOptimisticUserMessage ? stream.turnUserMessage : null,
        live: live && !!sessionId,
      }),
    [displayMessages, showOptimisticUserMessage, stream.turnUserMessage, live, sessionId],
  );

  // A boundary (a new user message, the live turn becoming its persisted message)
  // re-renders the transcript in a deferred, interruptible render (D-88): the
  // persisted answer is parsed in time slices while the live one stays on screen.
  const shownTurns = useDeferredValue(turns);

  const prevUsage = stream.prevUsageRef.current;
  const renderLive = useCallback(
    () =>
      sessionId ? (
        <LiveTurn
          sessionId={sessionId}
          agentName={agentName}
          harnessLabel={harnessLabel}
          prevUsage={prevUsage?.usage ?? null}
          prevCompletedAt={prevUsage?.completedAt ?? null}
          thinking={thinking}
        />
      ) : null,
    [sessionId, agentName, harnessLabel, prevUsage, thinking],
  );

  const renderUserActions = useCallback(
    (message: ChatMessage) => {
      const turnId = message.metadata?.turnId;
      const owner = message.chatId ?? chatId;
      return owner && turnId ? <RewindMenu chatId={owner} turnId={turnId} workspaceId={workspaceId} canRewind={canRewind} /> : null;
    },
    [chatId, workspaceId, canRewind],
  );

  const latestAssistantId = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i -= 1) {
      if (displayMessages[i]?.role === 'assistant') return displayMessages[i]!.id;
    }
    return undefined;
  }, [displayMessages]);
  const renderResponseActions = useCallback(
    (message: ChatMessage, engaged: boolean) => {
      const owner = message.chatId ?? chatId;
      if (!owner || message.role !== 'assistant') return null;
      const latest = message.id === latestAssistantId;
      // Hover-only actions mount once the response is hovered or focused (a
      // long transcript would otherwise mount two mutations per message).
      if (!latest && !engaged) return <div className="h-control-sm" aria-hidden />;
      return <MessageActions chatId={owner} turnId={message.metadata?.turnId} alwaysVisible={latest} />;
    },
    [chatId, latestAssistantId],
  );

  // Built from the individual (stable) callbacks, never from the `dock` /
  // `gates` objects: those are new every page render, and a new context value
  // re-renders every turn of the transcript.
  const { openChangesTab, openAgentShell, openPlanTab } = dock;
  const { approvePlan, requestPlanChanges, answerQuestion, answerPermission, decisionBusy } = gates;
  const actions = useMemo<TranscriptActions>(
    () => ({
      onOpenChanges: openChangesTab,
      onOpenShell: openAgentShell,
      onOpenPlan: openPlanTab,
      ...(focusDockTab
        ? { onOpenBrowser: () => focusDockTab('browser'), onOpenTasks: () => focusDockTab('tasks') }
        : {}),
      onApprovePlan: approvePlan,
      onRequestPlanChanges: requestPlanChanges,
      onAnswerQuestion: answerQuestion,
      onAnswerPermission: answerPermission,
      gateBusy: decisionBusy,
      ...(workspaceId ? { workspaceId } : {}),
      ...(chatId ? { chatId } : {}),
      ...(renderWidget && sessionId ? { renderWidget: (block: WidgetBlock) => renderWidget(block, sessionId) } : {}),
      ...(renderScmResult ? { renderScmResult } : {}),
      viewMode: renderedViewMode,
      // Not following the latest text (scrolled away): show it as it arrives, nothing to animate (D-91).
      pacing: !showJumpToLatest,
    }),
    [
      openChangesTab,
      openAgentShell,
      openPlanTab,
      focusDockTab,
      approvePlan,
      requestPlanChanges,
      answerQuestion,
      answerPermission,
      decisionBusy,
      workspaceId,
      chatId,
      renderWidget,
      renderScmResult,
      sessionId,
      renderedViewMode,
      showJumpToLatest,
    ],
  );

  const showEmpty =
    !messagesLoading && displayMessages.length === 0 && !stream.showStreamingMessage && !stream.isPending && !stream.pendingUserMessage;

  return (
    <TranscriptProvider value={actions}>
      <TranscriptView
        turns={shownTurns}
        scrollRef={scrollRef}
        agentName={agentName}
        loading={messagesLoading}
        loadingFallback={loadingFallback}
        hasMore={hasMoreMessages}
        onLoadEarlier={loadEarlier}
        empty={
          showEmpty ? (
            <EmptyState
              icon="agents"
              title={TRANSCRIPT_COPY.emptyTitle}
              description={TRANSCRIPT_COPY.emptyBody}
              className="mt-24"
            />
          ) : null
        }
        showJumpToLatest={showJumpToLatest}
        onJumpToLatest={jumpToLatest}
        viewMode={viewMode}
        {...(chatId ? { onViewModeChange: (mode) => setViewMode(chatId, mode) } : {})}
        renderUserActions={renderUserActions}
        renderResponseActions={renderResponseActions}
        renderLive={renderLive}
        // D-33 spike: no-go recorded in docs/redesign/reviews/P4-07-virtualization-spike.md —
        // every turn stays in the DOM (find, selection, a11y) and finished
        // responses before the last 20 turns start collapsed.
        virtualize="never"
        collapseBeyond={TRANSCRIPT_EXPANDED_TURNS}
      />
    </TranscriptProvider>
  );
}

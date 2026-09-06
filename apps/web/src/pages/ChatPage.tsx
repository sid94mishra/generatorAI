// ────────────────────────────────────────────────────────────────
// ChatPage — Full v2 Chat page with SSE streaming
//
// This page handles a first-class Chat entity (/chats/:id).
// It reuses existing chat components (ChatMessageList, StreamingMessage,
// ChatInput) but connects to the v2 chat endpoints and SSE streams.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useChat, useChatMessages, useSendChatPrompt, useUpdateChat, useCancelChat, useBackgroundTasks, useHarnessConfig } from '@/hooks/queries.js';
import { providerLabel } from '@/components/shared/ModelPicker.js';
// PLN-01 — plan mode
import { useDecidePlan, useAnswerQuestion, useAnswerPermission, usePendingInteractions } from '@/hooks/queries.js';
import { PlanDocumentPanel } from '@/components/chat/PlanDocumentPanel.js';
import type { AgentMode, ChatMessage } from '@generatorai/shared';
import { DEFAULT_AGENT_MODE } from '@generatorai/shared';
import { protectStream, useStreamStore } from '@/stores/streamStore.js';
import { useChatStore } from '@/stores/chatStore.js';
import { useStickToBottom } from '@/hooks/useStickToBottom.js';
import { useTwoPhaseStop } from '@/hooks/useTwoPhaseStop.js';
import { applyStopEffects } from '@/pages/chatStopEffects.js';
import { useComputerUseSettings } from '@/hooks/composerQueries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { connectChatSession } from '@/stores/sseManager.js';
import { AgentConsole } from '@/components/chat/AgentConsole.js';
import { hydrateWidgetsForChat } from '@/utils/hydrateWidgets.js';
import { ChatMessageList } from '@/components/chat/ChatMessageList.js';
import { StreamingMessage } from '@/components/chat/StreamingMessage.js';
import { awaitsUserDecision } from '@/components/agent/deriveTimeline.js';
import { ChatInput } from '@/components/chat/ChatInput.js';
import type { ComposerAttachment } from '@/components/chat/composer/types.js';
import type { UsageInfo } from '@/components/chat/redesign/types.js';
import { useFileTabs } from '@/components/diff/useFileTabs.js';
import { BrowserPanel, BrowserTabIcon, type BrowserTabState } from '@/components/chat/BrowserPanel.js';
import { ChatMessageSkeleton } from '@/components/Skeleton.js';
import { RightPane, useRightPaneOpen, type RightPaneTabDef } from '@/components/layout/RightPane.js';
import { clearBrowserTabUrl } from '@/lib/browserTabUrls.js';
import { useRightPaneStore } from '@/stores/rightPaneStore.js';
import { WidgetHost } from '@/components/widgets/WidgetHost.js';
import { widgetTabId, parseWidgetTabId } from '@/components/widgets/widgetTabId.js';
import { BackgroundTasksPanel } from '@/components/chat/BackgroundTasksPanel.js';
import { Loader2, Bot, User, Archive, ArrowDown, FolderGit2, TerminalSquare, LayoutGrid, Boxes, ClipboardList, PauseCircle, MonitorCog } from 'lucide-react';
import { openMultiplexedStream } from '@/platform/muxStream.js';
import {
  addableRightPaneTabs as addableRightPaneTabsFor,
  defaultRightPaneTab,
} from '@/platform/surfaceCapabilities.js';
import { cn } from '@/lib/utils.js';

// Right-pane-only surfaces, code-split out of the chat route chunk. They pull
// in the two heaviest dependency trees in the app (xterm + its WebGL addon;
// Shiki grammars via @pierre/diffs) and are never on the path to first paint —
// keeping them static delayed the composer and transcript on every chat open.
const TerminalPanel = React.lazy(() =>
  import('@/components/terminal/TerminalPanel.js').then((m) => ({ default: m.TerminalPanel })),
);
const ChangesSurface = React.lazy(() =>
  import('@/components/diff/ChangesSurface.js').then((m) => ({ default: m.ChangesSurface })),
);
const ComputerPanel = React.lazy(() =>
  import('@/components/chat/ComputerPanel.js').then((m) => ({ default: m.ComputerPanel })),
);

function PanelFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
    </div>
  );
}

/**
 * The one place that subscribes to the FULL live stream record.
 *
 * ChatPage used to do this at the top level, and the record is replaced on
 * every streamed token (W27) — so the whole page (RightPane's tabs, every
 * effect) re-rendered ~60x/second during a turn. Isolating the subscription
 * here means only this leaf pays that cost; ChatPage itself now reads only
 * narrow, primitive-derived selectors that change far less often.
 */
const LiveTranscript = React.memo(function LiveTranscript({
  sessionId,
  prevUsage,
  prevCompletedAt,
  onOpenPlan,
  onOpenChanges,
  onOpenShell,
  onApprovePlan,
  onRequestPlanChanges,
  onAnswerQuestion,
  onAnswerPermission,
  planBusy,
}: {
  sessionId: string | undefined;
  prevUsage: UsageInfo | null;
  prevCompletedAt: number | null;
  onOpenPlan: (planId: string) => void;
  onOpenChanges: (filePath?: string) => void;
  onOpenShell: (callId: string) => void;
  onApprovePlan: (planId: string, action: 'implement_interactive' | 'implement_autopilot') => void;
  onRequestPlanChanges: (planId: string, feedback: string) => void;
  onAnswerQuestion: (interactionId: string, answers: Record<string, string[]>, freeformResponse?: string) => void;
  onAnswerPermission: (interactionId: string, behavior: 'allow' | 'deny', message?: string) => void;
  planBusy: boolean;
}) {
  const stream = useStreamStore((state) => (sessionId ? state.streams[sessionId] : undefined));
  // Widgets keep the transcript "active" even once the turn itself is idle —
  // the LLM may have rendered one in an earlier turn and it stays live.
  const hasActiveWidgetBlock = stream != null && stream.blocks.some(
    (b) => b.type === 'widget' && b.surface === 'inline' && b.status !== 'closed',
  );
  const showStreamingMessage =
    stream != null && stream.blocks.length > 0 && (stream.status !== 'idle' || hasActiveWidgetBlock);

  if (!showStreamingMessage || !stream) return null;

  return (
    <StreamingMessage
      stream={stream}
      sessionId={sessionId}
      prevUsage={prevUsage}
      prevCompletedAt={prevCompletedAt}
      onOpenPlan={onOpenPlan}
      onOpenChanges={onOpenChanges}
      onOpenShell={onOpenShell}
      onApprovePlan={onApprovePlan}
      onRequestPlanChanges={onRequestPlanChanges}
      onAnswerQuestion={onAnswerQuestion}
      onAnswerPermission={onAnswerPermission}
      planBusy={planBusy}
    />
  );
});

/**
 * Same idea for the Terminal tab's agent shell console: it needs the live
 * stream to show in-progress shell blocks, but subscribing here — rather
 * than threading `stream` through the (memoised) RightPane `tabs` object —
 * keeps that per-token subscription scoped to exactly when the console is
 * actually mounted, and keeps `stream` out of the tabs memo's dependencies.
 */
const AgentShellPanel = React.memo(function AgentShellPanel({
  sessionId,
  messages,
  callId,
  onClose,
}: {
  sessionId: string | undefined;
  messages: readonly ChatMessage[] | undefined;
  callId: string;
  onClose: () => void;
}) {
  const stream = useStreamStore((state) => (sessionId ? state.streams[sessionId] : undefined));
  return <AgentConsole messages={messages} stream={stream} selectedCallId={callId} onClose={onClose} />;
});

export function ChatPage() {
  const { id: chatId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const platform = usePlatform();

  const { data: chat, isLoading: chatLoading, error: chatError } = useChat(chatId);
  // The empty-state used to name Copilot unconditionally, which is simply
  // wrong for a self-hosted install running HARNESS_TYPE=claude-agent — it
  // told the user they were talking to a provider they had not configured.
  const { data: harnessConfig } = useHarnessConfig();
  const activeHarnessLabel = harnessConfig?.harness?.type
    ? providerLabel(harnessConfig.harness.type)
    : null;
  // P0-48 fix: pagination — start with the most recent PAGE_SIZE messages.
  // The "Load more" button increases the limit incrementally so the user can
  // page back through history without fetching the entire corpus at once.
  const PAGE_SIZE = 100;
  const [msgLimit, setMsgLimit] = useState(PAGE_SIZE);
  const { data: messages, isLoading: messagesLoading } = useChatMessages(chatId, msgLimit);
  // F3 fix: use `> msgLimit - 1` (equivalent to `>=`) is still a false positive
  // when exactly msgLimit messages exist. Use `=== msgLimit` instead, which is
  // true only when the server filled the page — if fewer arrived, there are no
  // more. This still wastes one round-trip when the total count is a multiple
  // of PAGE_SIZE, but eliminates the infinite "Load earlier" loop for exact counts.
  const hasMoreMessages = (messages?.length ?? 0) === msgLimit;

  // The stream store is keyed by sessionId (not chatId).
  //
  // W-render — this used to subscribe to the WHOLE per-session record, whose
  // identity is replaced on every streamed token, which re-rendered this
  // entire page ~60x/second during a turn. Each selector below returns a
  // PRIMITIVE (or a value — like `usage` — that only changes when it
  // genuinely should), so Zustand's default equality check skips the
  // re-render unless that specific field actually changed. The live,
  // per-token content (`blocks`, `text`) is read only inside `LiveTranscript`
  // and `AgentShellPanel` — small leaf components that re-render on every
  // token so the rest of the page does not have to.
  const sessionId = chat?.sessionId;
  const streamStatus = useStreamStore((state) => (sessionId ? state.streams[sessionId]?.status : undefined));
  const hasStream = useStreamStore((state) => !!sessionId && state.streams[sessionId] != null);
  const turnUserMessage = useStreamStore((state) => (sessionId ? state.streams[sessionId]?.turnUserMessage : undefined)) ?? null;
  const pendingUserMessage = useStreamStore((state) => (sessionId ? state.streams[sessionId]?.pendingUserMessage : undefined)) ?? null;
  const serverTurnId = useStreamStore((state) => (sessionId ? state.streams[sessionId]?.serverTurnId : undefined)) ?? null;
  const blocksLength = useStreamStore((state) => (sessionId ? state.streams[sessionId]?.blocks.length ?? 0 : 0));
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
  const awaitingUserDecision = useStreamStore((state) =>
    awaitsUserDecision(sessionId ? state.streams[sessionId]?.blocks : undefined),
  );
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
  React.useEffect(() => {
    if (!sessionId) return;
    return protectStream(sessionId);
  }, [sessionId]);
  const sendChatMutation = useSendChatPrompt(chatId ?? '');
  const updateChatMutation = useUpdateChat(chatId ?? '');
  const cancelMutation = useCancelChat();


  // Model selection, git repos (local paths), and codebase selection state.
  // Starts empty rather than at a hardcoded id: the composer resolves an
  // empty selection to the first model the account actually has, whereas a
  // stale literal (the old `claude-sonnet-4`) matches nothing in the live
  // catalog and hides every model-derived control.
  const [selectedModel, setSelectedModel] = useState<string>(chat?.model ?? '');
  const [reasoningEffort, setReasoningEffort] = useState<string | undefined>(chat?.harnessConfig?.reasoningEffort);
  const [contextTier, setContextTier] = useState<string | undefined>(chat?.harnessConfig?.contextTier);
  const [gitRepositories, setGitRepositories] = useState<Array<{ url: string; branch: string; alias: string }>>([]);
  const [selectedCodebaseIds, setSelectedCodebaseIds] = useState<string[]>(chat?.codebaseIds ?? []);
  // Unified right side pane — tabs (Changes / Browser / …) are managed
  // inside RightPane; here we only track whether the pane is open.
  const [rightPaneOpen, setRightPaneOpen, toggleRightPane] = useRightPaneOpen('generatorai:rightPane:chat', false);
  // Bridge the pane toggle up to the global Header's side-pane icon.
  const setRightPaneController = useRightPaneStore((s) => s.setController);
  useEffect(() => {
    setRightPaneController({ open: rightPaneOpen, toggle: toggleRightPane });
    return () => setRightPaneController(null);
  }, [rightPaneOpen, toggleRightPane, setRightPaneController]);
  // Pending browser/terminal captures — previewed in the composer and attached
  // to the next chat send.
  const [pendingCaptures, setPendingCaptures] = useState<ComposerAttachment[]>([]);
  /**
   * Imperative "focus this tab" token — bumped when the server emits a
   * `browser.session_created` event so the pane pops the Browser tab
   * open automatically (Phase 2 of the built-in browser tools plan).
   * Combined with `visibility === 'visible'` from BrowserConfig this
   * gives users the "watch the agent live" UX with zero clicks.
   */
  const [browserTabFocusRequest, setBrowserTabFocusRequest] = useState<{ type: string; token: number; tabId?: string } | null>(null);
  // React Router reuses this component across /chats/:id, so a focus request
  // minted for the previous conversation would otherwise open that tab in the
  // next one (e.g. Background Tasks following you into a worker chat).
  useEffect(() => {
    setBrowserTabFocusRequest(null);
    setBgTabAutoOpened(false);
  }, [chatId]);
  // Per-instance browser tab state (keyed by the RightPane tab id) so each
  // "Browser" tab renders its own live title + favicon + spinner.
  const [browserTabs, setBrowserTabs] = useState<Record<string, BrowserTabState>>({});
  // Right-pane tabs are scoped to THIS chat, so opening three browser tabs in
  // one conversation no longer leaks them into every other conversation.
  const rightPaneStorageKey = `generatorai:rightPane:chat:${chatId ?? 'unknown'}`;
  // Namespace for each browser tab's remembered URL (see `browserTabUrls`).
  const browserUrlScopeKey = `chat:${chatId ?? 'unknown'}`;
  // Files tab + per-file tabs. Opening a file expands the pane first, so the
  // gesture works even when the user has it collapsed. Declared before the
  // close handler because that handler has to forget this tab's selection.
  const fileTabs = useFileTabs({
    workspaceId: chat?.workspaceId,
    requestFocus: setBrowserTabFocusRequest,
    openPane: () => setRightPaneOpen(true),
  });

  // Closing a tab for good drops whatever that tab remembered.
  const forgetFileTab = fileTabs.forgetTab;
  const handleRightPaneTabClose = useCallback(
    (tab: { id: string; type: string }) => {
      if (tab.type === 'files') {
        forgetFileTab(tab.id);
        return;
      }
      if (tab.type !== 'browser') return;
      clearBrowserTabUrl(browserUrlScopeKey, tab.id);
      setBrowserTabs((prev) => {
        if (!(tab.id in prev)) return prev;
        const next = { ...prev };
        delete next[tab.id];
        return next;
      });
    },
    [browserUrlScopeKey, forgetFileTab],
  );

  // Orchestrator mode — poll for spawned background tasks. Enabled only for
  // orchestrator chats. When the first task appears, pop the Background Tasks
  // tab automatically so the user sees the delegation happen.
  const isOrchestrator = !!chat?.orchestratorMode;
  // The Computer tab is only offered when desktop automation is actually on —
  // otherwise it is a tab that can never show anything.
  const computerUseEnabled = useComputerUseSettings().data?.enabled === true;
  // W29 — the panel list is a ledger decision, not a literal. A surface that
  // declares it cannot render the browser or computer live view must not be
  // offered a tab for it; see `platform/surfaceCapabilities.ts`.
  const addableRightPaneTabs = useMemo(
    () => addableRightPaneTabsFor({ computerUseEnabled, isOrchestrator }),
    [computerUseEnabled, isOrchestrator],
  );
  const { data: backgroundTasksData } = useBackgroundTasks(chatId, isOrchestrator);
  const backgroundTaskCount = backgroundTasksData?.tasks?.length ?? 0;
  const [bgTabAutoOpened, setBgTabAutoOpened] = useState(false);
  useEffect(() => {
    if (isOrchestrator && backgroundTaskCount > 0 && !bgTabAutoOpened) {
      setBgTabAutoOpened(true);
      setRightPaneOpen(true);
      setBrowserTabFocusRequest({ type: 'background_tasks', token: Date.now() });
    }
  }, [isOrchestrator, backgroundTaskCount, bgTabAutoOpened, setRightPaneOpen]);

  // ══════════════════════════════════════════════════════════════
  // PLN-01 — plan mode
  // ══════════════════════════════════════════════════════════════

  // Sticky per-chat default, overridable per turn from the composer.
  const [agentMode, setAgentMode] = useState<AgentMode>(DEFAULT_AGENT_MODE);
  useEffect(() => {
    if (chat?.defaultAgentMode) setAgentMode(chat.defaultAgentMode);
  }, [chat?.defaultAgentMode]);

  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [planTabAutoOpenedFor, setPlanTabAutoOpenedFor] = useState<string | null>(null);

  const decidePlan = useDecidePlan(chatId ?? '');
  const answerQuestion = useAnswerQuestion(chatId ?? '');
  const answerPermission = useAnswerPermission(chatId ?? '');
  // The blocking promise lives server-side, so polling rehydrates the gate
  // after a reload even when the SSE replay window has moved on.
  const { data: pendingInteractions, dataUpdatedAt: pendingFetchedAt } = usePendingInteractions(
    chatId,
    chat?.status === 'active',
  );
  const pendingGate = pendingInteractions?.[0];

  const openPlanTab = useCallback(
    (planId: string) => {
      setActivePlanId(planId);
      setRightPaneOpen(true);
      setBrowserTabFocusRequest({ type: 'plan', token: Date.now() });
    },
    [setRightPaneOpen],
  );

  // Per-op diff icons + the end-of-turn summary card land here. The file
  // path is accepted for future per-file scrolling; today the Changes tab
  // itself is the destination.
  const openChangesTab = useCallback(
    (_filePath?: string) => {
      setRightPaneOpen(true);
      setBrowserTabFocusRequest({ type: 'changes', token: Date.now() });
    },
    [setRightPaneOpen],
  );

  /** Which agent shell command the Terminal tab's console is focused on. */
  const [agentConsoleCallId, setAgentConsoleCallId] = useState<string | null>(null);
  const openAgentShell = useCallback(
    (callId: string) => {
      setAgentConsoleCallId(callId);
      setRightPaneOpen(true);
      setBrowserTabFocusRequest({ type: 'terminal', token: Date.now() });
    },
    [setRightPaneOpen],
  );

  // Auto-open the Plan tab the first time a plan asks for review — but only
  // when the tab is actually visible, matching the browser-tab guard.
  // (`awaitingPlanId` is one of the narrow stream selectors declared above.)
  useEffect(() => {
    if (!awaitingPlanId || planTabAutoOpenedFor === awaitingPlanId) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    setPlanTabAutoOpenedFor(awaitingPlanId);
    openPlanTab(awaitingPlanId);
  }, [awaitingPlanId, planTabAutoOpenedFor, openPlanTab]);

  // Card decisions are applied to the store OPTIMISTICALLY.
  //
  // Two reasons: instant feedback, and it closes a race — the pending-gate
  // poll can observe the resolved gate before the `chat.plan.decided` /
  // `chat.question.answered` SSE event lands, and the reconciliation effect
  // below would then wrongly mark the card expired.
  const handleApprovePlan = useCallback(
    (planId: string, action: 'implement_interactive' | 'implement_autopilot') => {
      if (sessionId) {
        useStreamStore.getState().setPlanStatus(sessionId, planId, 'approved');
      }
      decidePlan.mutate({ planId, approved: true, action });
    },
    [decidePlan, sessionId],
  );

  const handleRequestPlanChanges = useCallback(
    (planId: string, feedback: string) => {
      if (sessionId) {
        useStreamStore.getState().setPlanStatus(sessionId, planId, 'changes_requested');
      }
      decidePlan.mutate({ planId, approved: false, feedback });
    },
    [decidePlan, sessionId],
  );

  const handleAnswerQuestion = useCallback(
    (interactionId: string, answers: Record<string, string[]>, freeformResponse?: string) => {
      if (sessionId) {
        useStreamStore.getState().answerQuestion(sessionId, interactionId, answers, freeformResponse);
      }
      answerQuestion.mutate({
        interactionId,
        answers,
        ...(freeformResponse ? { freeformResponse } : {}),
      });
    },
    [answerQuestion, sessionId],
  );

  const handleAnswerPermission = useCallback(
    (interactionId: string, behavior: 'allow' | 'deny', message?: string) => {
      if (sessionId) {
        useStreamStore.getState().resolvePermission(sessionId, interactionId, behavior, message);
      }
      answerPermission.mutate({
        interactionId,
        behavior,
        ...(message ? { message } : {}),
      });
    },
    [answerPermission, sessionId],
  );

  /** Human-readable reason the composer is blocked, if it is. */
  const pendingInteractionLabel = useMemo(() => {
    if (!pendingGate) return null;
    if (pendingGate.kind === 'plan_review') {
      return 'Waiting on your plan review before the agent can continue.';
    }
    if (pendingGate.kind === 'tool_permission') {
      return 'The agent is waiting for you to allow or deny a tool call.';
    }
    return 'The agent is waiting for your answer.';
  }, [pendingGate]);

  // Reconcile optimistic card state against the server's pending gates.
  //
  // A card is rendered "pending" from a live SSE event, but the gate can die
  // server-side without the client hearing about it — a server restart expires
  // every in-flight chat gate, and the event can also fall outside the replay
  // window. Without this, the card would sit on "pending" forever and the
  // user's answer would come back 409. The pending list is authoritative.
  //
  // It is only authoritative about gates that already existed when it was
  // fetched, though: the list polls on an interval, so a card opened by SSE
  // moments ago is legitimately absent from the last response. Comparing the
  // card's `openedAt` with the poll's fetch time keeps a stale poll from
  // instantly killing a live gate.
  useEffect(() => {
    if (!sessionId || pendingInteractions === undefined) return;
    const live = new Set(pendingInteractions.map((i) => i.interactionId));
    const store = useStreamStore.getState();
    const isStale = (openedAt: number | undefined) =>
      openedAt !== undefined && openedAt > pendingFetchedAt;
    for (const block of store.streams[sessionId]?.blocks ?? []) {
      if (
        block.type === 'question' &&
        block.status === 'pending' &&
        !live.has(block.interactionId) &&
        !isStale(block.openedAt)
      ) {
        store.expireQuestion(sessionId, block.interactionId);
      }
      if (
        block.type === 'plan' &&
        block.status === 'awaiting_review' &&
        block.interactionId &&
        !live.has(block.interactionId) &&
        !isStale(block.openedAt)
      ) {
        store.setPlanStatus(sessionId, block.planId, 'expired');
      }
      if (
        block.type === 'permission' &&
        block.status === 'pending' &&
        !live.has(block.interactionId) &&
        !isStale(block.openedAt)
      ) {
        store.expirePermission(sessionId, block.interactionId);
      }
    }
  }, [sessionId, pendingInteractions, pendingFetchedAt, interactionBlocksKey]);

  // ── Split-pane resize state for chat ↔ right pane ────────────
  // The width itself is owned by `RightPane` via `useResizablePane`.

  // Sync model and codebaseIds from loaded chat entity
  useEffect(() => {
    if (chat?.model) {
      setSelectedModel(chat.model);
    }
    if (chat?.harnessConfig?.reasoningEffort) {
      setReasoningEffort(chat.harnessConfig.reasoningEffort);
    }
    if (chat?.harnessConfig?.contextTier) {
      setContextTier(chat.harnessConfig.contextTier);
    }
    if (chat?.codebaseIds !== undefined) {
      setSelectedCodebaseIds(chat.codebaseIds);
    }
    if (chat?.gitRepositories?.length) {
      setGitRepositories(chat.gitRepositories.map(r => ({ url: r.url, branch: '', alias: r.alias })));
    }
  }, [chat?.model, chat?.harnessConfig?.reasoningEffort, chat?.harnessConfig?.contextTier, chat?.codebaseIds, chat?.gitRepositories]);

  // The chat entity is authoritative until the user picks something else.
  // `selectedModel` is only synced in an effect, and React runs the composer's
  // effects before this page's, so reading it directly would hand ChatInput an
  // empty selection for one commit — long enough for its catalog fallback to
  // fire and persist the wrong model over the one the chat was created with.
  const effectiveModel = selectedModel || chat?.model || '';

  // Persist model changes to server
  const handleModelChange = useCallback((model: string) => {
    if (!chat) return;
    setSelectedModel(model);
    updateChatMutation.mutate({ model });
  }, [chat, updateChatMutation]);

  // Persist reasoning-effort changes into harnessConfig (merged with existing)
  const handleReasoningEffortChange = useCallback((effort: string) => {
    setReasoningEffort(effort);
    updateChatMutation.mutate({
      harnessConfig: { ...(chat?.harnessConfig ?? {}), reasoningEffort: effort },
    });
  }, [updateChatMutation, chat?.harnessConfig]);

  // Persist context-tier changes into harnessConfig (merged with existing)
  const handleContextTierChange = useCallback((tier: string) => {
    setContextTier(tier);
    updateChatMutation.mutate({
      harnessConfig: { ...(chat?.harnessConfig ?? {}), contextTier: tier },
    });
  }, [updateChatMutation, chat?.harnessConfig]);

  // Connect SSE (depends on stable primitives only to avoid reconnection churn)
  useEffect(() => {
    if (!chatId || !sessionId) return;
    const disconnect = connectChatSession(chatId, sessionId, platform);
    return () => {
      disconnect();
    };
  }, [chatId, sessionId, platform]);

  // Reconstitute widgets from the DB on mount — independent of the SSE
  // event-replay window, so widgets survive refresh even if their render
  // event has scrolled out of the replay log.
  useEffect(() => {
    if (!chatId || !sessionId) return;
    void hydrateWidgetsForChat(chatId, sessionId);
  }, [chatId, sessionId]);

  // Register chat entity in chatStore cache (can re-run on data updates)
  useEffect(() => {
    if (chat && sessionId) {
      useChatStore.getState().registerChat(chat.id, sessionId, chat);
    }
  }, [chat, sessionId]);

  // Set active chat in store
  useEffect(() => {
    if (chatId) {
      useChatStore.getState().setActiveChatId(chatId);
    }
    return () => {
      useChatStore.getState().setActiveChatId(null);
    };
  }, [chatId]);

  // Phase 2 of built-in browser tools — auto-open the Browser tab in
  // the right pane when the workspace signals `browser.session_created`
  // AND the config says the user wants to watch (`visibility: 'visible'`
  // OR the legacy `enabled: true` without visibility set which we treat
  // as opt-in). We subscribe to the unified SSE stream scoped to
  // `browser:<workspaceId>` — same channel `BrowserPanel` uses for its
  // reactive updates, but here we react at the page level to change the
  // right-pane state before the user opens it.
  const chatWorkspaceId = chat?.workspaceId;
  useEffect(() => {
    if (!chatWorkspaceId) return;
    let cancelled = false;
    // 1) On-mount probe — chat creation may have already fired
    //    `browser.session_created` before we subscribed, so query the
    //    descriptor once. If visibility === 'visible' and the session is
    //    active, pop the Browser tab.
    void fetch(`/api/workspaces/${chatWorkspaceId}/browser/descriptor`)
      .then((r) => (r.ok ? r.json() : null))
      .then((desc: { ready?: boolean; config?: { visibility?: string } } | null) => {
        if (cancelled || !desc?.ready) return;
        if (desc.config?.visibility === 'visible') {
          setRightPaneOpen(true);
          setBrowserTabFocusRequest({ type: 'browser', token: Date.now() });
        }
      })
      .catch(() => undefined);
    // 2) Live SSE — for sessions that flip to active *after* the page
    //    mounts (e.g. LLM calls open_browser_page lazily).
    const es = openMultiplexedStream(
      'session',
      `browser:${chatWorkspaceId}`,
      {
        onMessage: (e) => {
          if (cancelled) return;
          try {
            const payload = JSON.parse(e.data) as { kind?: string };
            if (payload.kind !== 'browser.session_created') return;
            // Fetch fresh descriptor to check visibility policy before opening.
            void fetch(`/api/workspaces/${chatWorkspaceId}/browser/descriptor`)
              .then((r) => (r.ok ? r.json() : null))
              .then((desc: { config?: { visibility?: string } } | null) => {
                if (cancelled || !desc) return;
                // Open when visibility is 'visible' OR unset (backwards compat).
                const v = desc.config?.visibility;
                if (v === 'visible' || v === undefined) {
                  setRightPaneOpen(true);
                  setBrowserTabFocusRequest({ type: 'browser', token: Date.now() });
                }
              })
              .catch(() => undefined);
          } catch { /* ignore */ }
        },
      },
      ['browser.session_created'],
    );
    return () => {
      cancelled = true;
      try { es.close(); } catch { /* noop */ }
    };
  }, [chatWorkspaceId, setRightPaneOpen]);

  // Computer Use — pop the Computer tab open when the agent starts driving the
  // desktop, and unconditionally when it asks for consent. A consent prompt
  // that renders inside a tab nobody has open is the same as no prompt at all:
  // it expires into a denial while the user watches an idle chat.
  useEffect(() => {
    if (!chatWorkspaceId || !computerUseEnabled) return;
    let cancelled = false;
    const es = openMultiplexedStream(
      'session',
      `computer:${chatWorkspaceId}`,
      {
        onMessage: (e) => {
          if (cancelled) return;
          try {
            const frame = JSON.parse(e.data) as { kind?: string };
            if (
              frame.kind !== 'computer.session_started' &&
              frame.kind !== 'computer.consent_required'
            ) {
              return;
            }
            setRightPaneOpen(true);
            setBrowserTabFocusRequest({ type: 'computer', token: Date.now() });
          } catch { /* ignore */ }
        },
      },
      ['computer.'],
    );
    return () => {
      cancelled = true;
      try { es.close(); } catch { /* noop */ }
    };
  }, [chatWorkspaceId, computerUseEnabled, setRightPaneOpen]);

  // Auto-open a tab per full-page widget. The tab id encodes the instance, so
  // a second widget gets its OWN tab instead of re-focusing the first one's,
  // and re-rendering the same widget focuses the tab already showing it.
  const seenCanvasWidgetsRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    // Triggered by `widgetSurfaceKey` (a cheap instanceId:status signature)
    // rather than the live `stream`, so this effect only re-runs when a
    // full-page widget block actually appears/changes status — not on every
    // streamed token. The actual blocks are read fresh from the store here.
    if (!sessionId) return;
    const blocks = useStreamStore.getState().streams[sessionId]?.blocks ?? [];
    for (const b of blocks) {
      if (b.type !== 'widget') continue;
      if (b.surface !== 'widget') continue;
      if (b.status === 'closed') continue;
      if (seenCanvasWidgetsRef.current.has(b.instanceId)) continue;
      seenCanvasWidgetsRef.current.add(b.instanceId);
      setRightPaneOpen(true);
      setBrowserTabFocusRequest({
        type: 'widget',
        token: Date.now(),
        tabId: widgetTabId(b.instanceId),
      });
    }
  }, [sessionId, widgetSurfaceKey, setRightPaneOpen]);

  const openWidgetTab = useCallback(
    (instanceId: string) => {
      setRightPaneOpen(true);
      setBrowserTabFocusRequest({ type: 'widget', token: Date.now(), tabId: widgetTabId(instanceId) });
    },
    [setRightPaneOpen],
  );

  // Stream state — derived from the narrow selectors declared above, not a
  // full `stream` object, so these stay stable across most streamed tokens.
  const isStreaming = streamStatus === 'streaming' || streamStatus === 'thinking';
  const isPending = streamStatus === 'pending';
  const isCopilotWorking = isStreaming || isPending;
  const isInputDisabled = isStreaming || isPending;
  const isChatActive = chat?.status === 'active';

  /**
   * W30-b — two-phase Stop.
   *
   * `isLive` is the BACKEND's view: `stream.status` is driven entirely by the
   * event stream, so a turn the server has settled returns the control to idle
   * even when the cancel request itself got no response, and a turn the server
   * is still running keeps offering escalation regardless of how many times
   * the button was pressed. That is the fourth rule of W30-b, and it is why
   * this is not a local `hasPressedStop` boolean.
   *
   * `requestCancel` latches the stream out of its live statuses so the events
   * still draining out of the provider cannot flip it back to `streaming` —
   * without it the button reappears mid-abort and the click reads as a no-op.
   * The blocks are KEPT: stopping is how you say "that is enough, let me read
   * it", and the auto-clear effect swaps them for the persisted message once
   * the history refetch lands.
   */
  const stop = useTwoPhaseStop({
    isLive: isCopilotWorking,
    onCancel: ({ force }) => {
      if (!chatId) return;
      applyStopEffects(useStreamStore.getState(), sessionId, force);
      cancelMutation.mutate(chatId);
    },
  });

  // The turn is parked on a gate: the agent is idle and the ball is with the
  // user, so every "generating" affordance must stand down.
  // (`awaitingUserDecision` is one of the narrow stream selectors above.)

  // W30: Track the previous completed turn's usage for the cache-miss notice.
  // When a turn transitions to 'complete', capture its usage in a ref so the
  // NEXT turn's UsageChip can compare against it.
  const prevUsageRef = React.useRef<{ usage: UsageInfo; completedAt: number } | null>(null);
  React.useEffect(() => {
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
          provider: lastStreamUsage.provider,
        },
        completedAt: Date.now(),
      };
    }
  }, [lastStreamUsage, streamStatus]);

  // Whether the current turn has produced its OWN content yet (text / tool
  // steps / answer) — i.e. anything other than blocks carried across the
  // turn barrier (widgets are preserved from previous turns by startPending).
  // Used to gate the pending spinner: a follow-up prompt in a widget chat
  // still has carried widget blocks, which must NOT suppress the "thinking"
  // indicator, otherwise the user sees no feedback after sending.
  // (`hasNewTurnContent` is one of the narrow stream selectors above.)

  // Whether the transcript has anything to show right now — gates both the
  // empty state below and whether `<LiveTranscript>` renders anything.
  const showStreamingMessage = hasStream && blocksLength > 0 && (streamStatus !== 'idle' || hasActiveWidgetBlock);

  // Display messages dedup (same logic as ChatView)
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

  // Optimistic user message
  const showOptimisticUserMessage = useMemo(
    () => !!turnUserMessage && streamStatus !== 'idle',
    [turnUserMessage, streamStatus],
  );

  // Stick-to-bottom: auto-follow while pinned near the bottom; surface a
  // "jump to latest" pill when the user scrolls up to read mid-stream.
  //
  // `useStickToBottom` re-binds on this signature and then follows content
  // growth itself via a `ResizeObserver` on the scrolled element — so the
  // signature only needs to change on message-count/block-count/status
  // boundaries, NOT on every streamed token (`stream.text` grows every
  // token; deliberately left out here).
  const scrollSignature = `${displayMessages.length}:${blocksLength}:${streamStatus ?? ''}`;
  const { ref: scrollRef, showJumpToLatest, jumpToLatest } = useStickToBottom(scrollSignature);

  // Auto-clear completed stream once chatMessages catches up. Only matters at
  // the turn-complete boundary, so this is keyed off `streamStatus` (a
  // primitive) and reads the live blocks/turnUserMessage from a fresh
  // snapshot rather than subscribing to them reactively.
  useEffect(() => {
    if (streamStatus !== 'complete' || !sessionId) return;
    if (!messages?.length) return;

    const current = useStreamStore.getState().streams[sessionId];
    if (!current || current.status !== 'complete') return;

    // Preserve stream state when it holds widget blocks — widgets live only
    // in the event stream (not in chat history), so clearing here would
    // drop the inline widget iframes the LLM rendered during the turn.
    const hasWidgetBlocks = current.blocks.some((b) => b.type === 'widget');
    if (hasWidgetBlocks) return;

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

  // Right-pane tabs — memoised so a token frame (which changes `stream`,
  // deliberately excluded from these deps) does not rebuild all ~10 panel
  // configs and defeat RightPane's own per-panel memoisation (see the
  // `Component`/`render` doc comment in RightPane.tsx). Anything that needs
  // the live stream (the terminal's shell console, the widget tab's live
  // label) reads it narrowly instead of closing over a value captured here —
  // `AgentShellPanel` subscribes itself, and `widgetLabel` below reads a
  // fresh snapshot only when `widgetTitlesKey` actually changes.
  const tabs = useMemo<Record<string, RightPaneTabDef>>(() => {
    // `widgetTitlesKey` (in the dep array below) is a trigger-only
    // dependency: it is not read here directly, but its identity is what
    // this factory should recompute on — a fresh snapshot is taken from the
    // store below instead, exactly when that key says a widget's title
    // actually changed.
    void widgetTitlesKey;
    const widgetLabel = (instanceId: string): string => {
      const blocks = sessionId ? (useStreamStore.getState().streams[sessionId]?.blocks ?? []) : [];
      const block = blocks.find((b) => b.type === 'widget' && b.instanceId === instanceId);
      return (block && block.type === 'widget' && (block.title ?? block.component)) || 'Widget';
    };

    return {
      changes: {
        label: 'Changes',
        description: 'Files & changes for this chat',
        icon: <FolderGit2 className="h-3.5 w-3.5" />,
        render: () => (
          <React.Suspense fallback={<PanelFallback />}>
            <ChangesSurface
              embedded
              workspaceId={chat?.workspaceId}
              enableReview
              // Threads are scoped to the chat; the send target is also the
              // chat, so "Send all" posts the batch as a new user turn.
              reviewScope={{ scope: 'chat', scopeId: chatId ?? '' }}
              {...(chatId ? { reviewTarget: { kind: 'chat', chatId } } : {})}
            />
          </React.Suspense>
        ),
      },
      files: fileTabs.filesTab,
      file: fileTabs.fileTab,
      browser: {
        label: 'Browser',
        description: 'Integrated browser for this chat',
        icon: <BrowserTabIcon state={null} />,
        allowMultiple: true,
        maxInstances: 5,
        getTabLabel: ({ id, index }) => {
          const t = (browserTabs[id]?.title ?? '').trim();
          return t || (index <= 1 ? 'Browser' : `Browser ${index}`);
        },
        getTabIcon: ({ id }) => <BrowserTabIcon state={browserTabs[id] ?? null} />,
        disabled: !chat?.workspaceId,
        disabledReason: 'Send a message first to create a workspace',
        render: (ctx) => (
          chat?.workspaceId ? (
            <div className="flex h-full min-h-0 flex-1 flex-col">
              {/* Pending-capture banner is hoisted above ChatInput for
                  visibility across all right-pane tabs. */}
              <div className="flex-1 min-h-0">
                <BrowserPanel
                  embedded
                  workspaceId={chat.workspaceId}
                  tabId={ctx.id}
                  urlScopeKey={browserUrlScopeKey}
                  open={true}
                  // P1-50 — every tab is mounted; only the selected one
                  // may hold a live screencast socket.
                  visible={ctx.active}
                  onClose={() => setRightPaneOpen(false)}
                  onCapture={(file) =>
                    setPendingCaptures((prev) => [
                      ...prev,
                      { id: `browser:${Date.now()}:${file.name}`, file, source: 'browser', label: file.name },
                    ])
                  }
                  onTabStateChange={(s) => setBrowserTabs((prev) => {
                    const cur = prev[ctx.id];
                    if (cur && cur.loading === s.loading && cur.title === s.title && cur.favicon === s.favicon && cur.url === s.url) return prev;
                    return { ...prev, [ctx.id]: s };
                  })}
                  agentBusy={isCopilotWorking}
                />
              </div>
            </div>
          ) : (
            <div className="p-4 text-xs text-[var(--color-muted-foreground)]">
              Browser is not available until this chat has a workspace.
            </div>
          )
        ),
      },
      terminal: {
        label: 'Terminal',
        description: 'Integrated shell in this workspace',
        icon: <TerminalSquare className="h-3.5 w-3.5" />,
        allowMultiple: true,
        // P2-54 — terminals are the one uncapped WebGL-context consumer:
        // each xterm instance takes a WebGL context, and browsers hand out
        // ~16 per page before evicting the oldest, at which point earlier
        // terminals silently stop painting. Also one PTY per tab on the
        // host. 4 is above any observed real use of parallel shells.
        maxInstances: 4,
        disabled: !chat?.workspaceId,
        disabledReason: 'Send a message first to create a workspace',
        render: (ctx) => (
          <React.Suspense fallback={<PanelFallback />}>
            {agentConsoleCallId != null ? (
              <AgentShellPanel
                sessionId={sessionId}
                messages={messages}
                callId={agentConsoleCallId}
                onClose={() => setAgentConsoleCallId(null)}
              />
            ) : (
              <TerminalPanel
                embedded
                workspaceId={chat?.workspaceId}
                tabId={ctx.id}
                onCapture={(file) =>
                  setPendingCaptures((prev) => [
                    ...prev,
                    { id: `terminal:${Date.now()}:${file.name}`, file, source: 'terminal', label: file.name },
                  ])
                }
                agentBusy={isCopilotWorking}
              />
            )}
          </React.Suspense>
        ),
      },
      computer: {
        label: 'Computer',
        description: 'Watch the desktop windows the agent reads and acts on',
        icon: <MonitorCog className="h-3.5 w-3.5" />,
        disabled: !chat?.workspaceId,
        disabledReason: 'Send a message first to create a workspace',
        render: (ctx) => (
          <React.Suspense fallback={<PanelFallback />}>
            <ComputerPanel embedded workspaceId={chat?.workspaceId} active={ctx.active} />
          </React.Suspense>
        ),
      },
      widget: {
        label: 'Widget',
        description: 'Agent-rendered interactive widgets in a full-page surface',
        icon: <LayoutGrid className="h-3.5 w-3.5" />,
        // One tab per widget instance — several widgets in one chat must
        // not compete for a single surface.
        allowMultiple: true,
        maxInstances: 6,
        disabled: !sessionId,
        disabledReason: 'Start the chat to enable widgets',
        getTabLabel: ({ id }) => {
          const instanceId = parseWidgetTabId(id);
          return instanceId ? widgetLabel(instanceId) : 'Widgets';
        },
        render: (ctx) => {
          if (!sessionId) {
            return <div className="p-4 text-xs text-[var(--color-muted-foreground)]">No active session.</div>;
          }
          const instanceId = parseWidgetTabId(ctx.id);
          return instanceId ? (
            <WidgetHost sessionId={sessionId} instanceId={instanceId} />
          ) : (
            // Unbound tab (added from "+", or stored before widgets got
            // their own tabs) — a picker, so it never mounts a second live
            // copy of a widget that already has a tab.
            <WidgetHost sessionId={sessionId} onOpenWidget={openWidgetTab} />
          );
        },
      },
      background_tasks: {
        label: 'Background Tasks',
        description: 'Background agent tasks spawned by this orchestrator chat',
        icon: <Boxes className="h-3.5 w-3.5" />,
        allowMultiple: false,
        disabled: !isOrchestrator,
        disabledReason: 'Enable Orchestrate mode on this chat to spawn background tasks',
        render: () => <BackgroundTasksPanel chatId={chatId} />,
      },
      // PLN-01 — the plan document surface. Auto-opens when the agent asks
      // for a review; also addable so a user can revisit an older plan.
      plan: {
        label: 'Plan',
        description: 'Review, edit and approve the agent’s implementation plan',
        icon: <ClipboardList className="h-3.5 w-3.5" />,
        allowMultiple: false,
        render: () =>
          chatId ? (
            <PlanDocumentPanel chatId={chatId} planId={activePlanId} />
          ) : (
            <div className="p-4 text-xs text-[var(--color-muted-foreground)]">No chat.</div>
          ),
      },
    };
  }, [
    chat?.workspaceId,
    chatId,
    sessionId,
    fileTabs.filesTab,
    fileTabs.fileTab,
    browserTabs,
    browserUrlScopeKey,
    setRightPaneOpen,
    setPendingCaptures,
    isCopilotWorking,
    agentConsoleCallId,
    setAgentConsoleCallId,
    messages,
    isOrchestrator,
    activePlanId,
    openWidgetTab,
    widgetTitlesKey,
  ]);

  // Loading
  if (!chatId) {
    navigate('/');
    return null;
  }

  // Only the chat record gates the shell: the composer needs `chat.sessionId`,
  // nothing else. Waiting on the message page too made the input box appear
  // only after the slower of two round trips — the transcript now streams in
  // under its own skeleton while the rest of the page is already interactive.
  if (chatLoading) {
    return <ChatMessageSkeleton />;
  }

  if (chatError || !chat) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-[var(--color-destructive)]">Chat not found</p>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-[var(--color-primary)] underline"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full">
      {/* Main chat column */}
      <div className="flex flex-1 flex-col min-w-0">
      {/* Streaming status banner */}
      {isCopilotWorking && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-primary)]/5 px-4 py-2">
          {awaitingUserDecision ? (
            <PauseCircle className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-primary)]" />
          )}
          <span className="text-xs font-medium text-[var(--color-primary)]">
            {awaitingUserDecision
              ? 'Paused — waiting for your input'
              : isStreaming ? 'Generating response...' : 'Processing...'}
          </span>
        </div>
      )}

      {/* Archived banner */}
      {chat.status === 'archived' && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-amber-500/5 px-4 py-2">
          <Archive className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            This chat has been archived
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="mx-auto max-w-3xl">
        {messagesLoading && <ChatMessageSkeleton />}
        {/* P0-48 fix: "Load more" — lets the user page back through history beyond
            the initial PAGE_SIZE. Shown only when the current fetch returned a full
            page (meaning older messages exist server-side). */}
        {hasMoreMessages && !messagesLoading && (
          <div className="mb-4 flex justify-center">
            <button
              type="button"
              onClick={() => setMsgLimit((prev) => prev + PAGE_SIZE)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-xs text-[var(--color-muted-foreground)] transition hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]"
            >
              Load earlier messages
            </button>
          </div>
        )}
        {displayMessages.length > 0 && (
          <ChatMessageList
            messages={displayMessages}
            onOpenPlan={openPlanTab}
            onOpenChanges={openChangesTab}
            onOpenShell={openAgentShell}
            // Thread the page-level scroll ref so VirtualChatList can attach
            // to the outer scroll container rather than creating a nested one.
            // This avoids dual scroll bars and the 60-vh height cap (W30 fix).
            scrollElementRef={scrollRef}
          />
        )}
        {/* Optimistic user message — right-aligned bubble (matches UserMessage
            + workflow stage prompt for a consistent stream layout). */}
        {showOptimisticUserMessage && (
          <div className="mt-5 flex justify-end">
            <div className="max-w-[85%] min-w-0">
              <div className="rounded-2xl rounded-br-sm border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/[0.08] px-3.5 py-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary)]/80">
                  <User className="h-2.5 w-2.5" />
                  You
                  <span className="ml-auto font-normal normal-case tracking-normal text-[var(--color-muted-foreground)]">just now</span>
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-foreground)]/90">{turnUserMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Streaming message — LiveTranscript owns the per-token subscription
            (see its definition above `ChatPage`) so this page does not. */}
        {showStreamingMessage && (
          <LiveTranscript
            sessionId={sessionId}
            prevUsage={prevUsageRef.current?.usage ?? null}
            prevCompletedAt={prevUsageRef.current?.completedAt ?? null}
            onOpenPlan={openPlanTab}
            onOpenChanges={openChangesTab}
            onOpenShell={openAgentShell}
            onApprovePlan={handleApprovePlan}
            onRequestPlanChanges={handleRequestPlanChanges}
            onAnswerQuestion={handleAnswerQuestion}
            onAnswerPermission={handleAnswerPermission}
            planBusy={decidePlan.isPending || answerQuestion.isPending || answerPermission.isPending}
          />
        )}

        {/* Empty state */}
        {!messagesLoading && displayMessages.length === 0 && !showStreamingMessage && !isPending && !pendingUserMessage && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-accent)]">
              <Bot className="h-8 w-8 text-[var(--color-primary)] opacity-60" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-[var(--color-foreground)] opacity-70">
                Start the conversation
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                {activeHarnessLabel
                  ? `Type a message below to chat with ${activeHarnessLabel}`
                  : 'Type a message below to start chatting'}
              </p>
            </div>
          </div>
        )}

        {/* Pending spinner — headerless (no avatar) to match the workflow
            stage stream's loading state. Shown whenever the turn is pending
            and hasn't produced its own content yet; carried-over widget
            blocks (preserved across the turn barrier) must not suppress it. */}
        {isPending && !hasNewTurnContent && (
          <div className="animate-block-in mt-4">
            <div className="space-y-3">
              {/* Spinner + status text */}
              <div className="flex items-center gap-2.5">
                <div className="flex gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[var(--color-primary)] dot-pulse-1" />
                  <span className="h-2 w-2 rounded-full bg-[var(--color-primary)] dot-pulse-2" />
                  <span className="h-2 w-2 rounded-full bg-[var(--color-primary)] dot-pulse-3" />
                </div>
                <span className="text-sm font-medium text-[var(--color-foreground)]">
                  {activeHarnessLabel ?? 'Agent'} is thinking...
                </span>
              </div>
              {/* Shimmer skeleton lines */}
              <div className="space-y-2.5 max-w-md">
                <div className="skeleton-shimmer h-3.5 w-[90%] rounded-md" />
                <div className="skeleton-shimmer h-3.5 w-[75%] rounded-md" />
                <div className="skeleton-shimmer h-3.5 w-[60%] rounded-md" />
                <div className="skeleton-shimmer h-3.5 w-[45%] rounded-md" />
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
      {showJumpToLatest && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-md transition-colors hover:bg-[var(--color-subtle)]"
        >
          <ArrowDown className="h-3.5 w-3.5" /> Jump to latest
        </button>
      )}
      </div>

      {/* Input — only for active chats (uses shared ChatInput with custom send) */}
      {isChatActive && sessionId && (
        <>
          <ChatInput
            sessionId={sessionId}
            disabled={isInputDisabled}
            placeholder={isInputDisabled ? 'Waiting for response...' : 'What feature are you dreaming up?'}
            selectedModel={effectiveModel}
            onModelChange={handleModelChange}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={handleReasoningEffortChange}
            contextTier={contextTier}
            onContextTierChange={handleContextTierChange}
            gitRepositories={gitRepositories}
            projectId={chat?.projectId}
            codebaseIds={selectedCodebaseIds}
            workspaceId={chat?.workspaceId}
            showModelSelector={true}
            showGitConnector={true}
            onToggleFilesPanel={toggleRightPane}
            filesPanelOpen={rightPaneOpen}
            isStreaming={isCopilotWorking}
            pendingCaptures={pendingCaptures}
            onRemovePendingCapture={(id) => setPendingCaptures((prev) => prev.filter((c) => c.id !== id))}
            onBuiltinCommand={async (commandId) => {
              const wsId = chat?.workspaceId;
              if (commandId === 'builtin:browser') {
                // Start the integrated browser in VISIBLE mode so the panel
                // opens and the user watches the agent drive it. The agent's
                // subsequent lazy `open_browser_page` reuses this session, so
                // it stays visible instead of running headless. Then focus the
                // Browser tab.
                if (wsId) {
                  try {
                    await fetch(`/api/workspaces/${wsId}/browser/start`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ config: { enabled: true, visibility: 'visible' } }),
                    });
                  } catch {
                    /* non-fatal — the agent still lazy-starts (headless) */
                  }
                }
                setRightPaneOpen(true);
                setBrowserTabFocusRequest({ type: 'browser', token: Date.now() });
              } else if (commandId === 'builtin:terminal') {
                // Surface the integrated terminal so the user can watch the
                // agent run commands live.
                setRightPaneOpen(true);
                setBrowserTabFocusRequest({ type: 'terminal', token: Date.now() });
              }
            }}
            stopState={stop}
            onStop={stop.press}
            customSendFn={async ({ prompt, attachments, mode }) => {
              const mergedAttachments = pendingCaptures.length
                ? [...attachments, ...pendingCaptures.map((c) => c.file)]
              : attachments;
            await sendChatMutation.mutateAsync({
              prompt,
              attachments: mergedAttachments,
              ...(mode ? { mode } : {}),
            });
            if (pendingCaptures.length) setPendingCaptures([]);
          }}
          agentMode={agentMode}
          onAgentModeChange={(mode) => {
            setAgentMode(mode);
            // Persist as the chat's sticky default, matching how the model and
            // reasoning-effort pickers behave.
            if (chatId) updateChatMutation.mutate({ defaultAgentMode: mode });
          }}
          showAgentModePicker={!chat?.parentChatId}
          {...(chat?.agentSnapshot?.driving?.name
            ? { agentName: chat.agentSnapshot.driving.name }
            : {})}
          pendingInteractionLabel={pendingInteractionLabel}
          onCancelPendingInteraction={() => {
            if (!chatId) return;
            if (sessionId) {
              const store = useStreamStore.getState();
              store.clearStream(sessionId);
              store.requestCancel(sessionId);
            }
            cancelMutation.mutate(chatId);
          }}
        />
        </>
      )}
      </div>

      {/* Unified right side pane — Changes (default), Browser (add-able). */}
      <RightPane
        open={rightPaneOpen}
        onOpenChange={setRightPaneOpen}
        storageKey={rightPaneStorageKey}
        widthStorageKey="generatorai:rightPane:chat:width"
        defaultTabType={defaultRightPaneTab()}
        addableTabTypes={addableRightPaneTabs}
        focusTabRequest={browserTabFocusRequest}
        onTabClose={handleRightPaneTabClose}
        tabs={tabs}
      />
    </div>
  );
}

export { ChatPage as ChatPageComponent };

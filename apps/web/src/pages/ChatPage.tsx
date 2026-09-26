// ────────────────────────────────────────────────────────────────
// ChatPage — Full v2 Chat page with SSE streaming
//
// This page handles a first-class Chat entity (/chats/:id).
// It reuses existing chat components (ChatMessageList, StreamingMessage,
// ChatInput) but connects to the v2 chat endpoints and SSE streams.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useChat } from '@/hooks/queries.js';
import { ChatChangesTray } from '@/components/chat/ChatChangesTray.js';
import { LiveActivityStrip, useRunningBackgroundTaskCount } from '@/components/agent/LiveActivityStrip.js';
import { PathRootsContext } from '@/blocks/changes/changePaths.js';
import { EditSourcesDialog } from '@/components/chat/sources/EditSourcesDialog.js';
import { providerLabel } from '@/components/shared/ModelPicker.js';
import type { ChatMessage } from '@generatorai/shared';
import { useStreamStore } from '@/stores/streamStore.js';
import { AgentConsole } from '@/components/chat/AgentConsole.js';
import { WidgetFrame } from '@/blocks/widgets/index.js';
import { ScmResultCard } from '@/components/scm/ScmResultCard.js';
import { awaitsUserDecision, type ScmResultBlock, type WidgetBlock } from '@generatorai/client-core';
import { Composer, type ComposerAttachment } from '@/blocks/composer/index.js';
import { useFileTabs } from '@/components/diff/useFileTabs.js';
import { BrowserPanel, type BrowserTabState } from '@/components/chat/BrowserPanel.js';
import { ChatMessageSkeleton } from '@/components/Skeleton.js';
import { Dock, useDockOpen, type DockRegistry } from '@/blocks/dock/index.js';
import { ChangesDockContext, ChangesDockPanel } from '@/blocks/changes/ChangesDockPanel.js';
import type { ChangesPanelProps } from '@/blocks/changes/ChangesPanel.js';
import { parseWidgetTabId } from '@/lib/widgetTabId.js';
import { Loader2, Bot, User, Archive, ArrowDown, PauseCircle, GitFork } from 'lucide-react';
import { defaultDockTab, dockAddableTabTypes, dockTabTypes } from '@/platform/surfaceCapabilities.js';
import { Button } from '@/components/ui/index.js';
import {
  CHAT_DOCK_KEYS,
  CHAT_DOCK_TAB_CAPS,
  ChatComputerDockPanel,
  ChatDockContext,
  ChatPlanDockPanel,
  ChatTasksDockPanel,
  ChatTranscript,
  ChatWidgetDockPanel,
  useChatView,
  type ChatDockContextValue,
} from '@/features/chat/index.js';

// Right-pane-only surfaces, code-split out of the chat route chunk. They pull
// in the two heaviest dependency trees in the app (xterm + its WebGL addon;
// Shiki grammars via @pierre/diffs) and are never on the path to first paint —
// keeping them static delayed the composer and transcript on every chat open.
const TerminalPanel = React.lazy(() =>
  import('@/components/terminal/TerminalPanel.js').then((m) => ({ default: m.TerminalPanel })),
);

function PanelFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
    </div>
  );
}

/**
 * "Forked from <parent>" — where a branched conversation came from.
 *
 * The parent's name is fetched lazily (one small query, only on a fork) and
 * falls back to a neutral label rather than an id: a chat the user can no
 * longer read is still worth saying came from somewhere.
 */
function ForkProvenanceChip({ parentChatId }: { parentChatId: string }) {
  const navigate = useNavigate();
  const { data: parent } = useChat(parentChatId);
  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-1.5">
      <Button variant="unstyled"
        type="button"
        data-testid="fork-provenance"
        onClick={() => navigate(`/chats/${parentChatId}`)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]"
        title="Open the chat this one branched from. The fork has its own copy of the files, on its own branch."
      >
        <GitFork className="h-3 w-3" />
        {parent?.name ? `Forked from ${parent.name}` : 'Forked chat'}
      </Button>
    </div>
  );
}

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

  // The right dock (D-27) — tabs are managed inside `Dock`; here we only track
  // whether it is open (collapsed, never unmounted, when closed).
  const [rightPaneOpen, setRightPaneOpen, toggleRightPane] = useDockOpen(CHAT_DOCK_KEYS.open, false);
  const view = useChatView({
    chatId,
    dockOpen: rightPaneOpen,
    setDockOpen: setRightPaneOpen,
    toggleDock: toggleRightPane,
  });
  const { chat, sessionId, workspace, stream, transcript, gates, stopRewind, dock } = view;
  const { isStreaming, isWorking: isCopilotWorking } = stream;
  const { messages, promptHistory } = transcript;
  const { stop, canRewind, restoredDraft } = stopRewind;
  const isChatActive = view.chatActive;
  const activeHarnessLabel = workspace.harnessProvider ? providerLabel(workspace.harnessProvider) : null;

  // The turn is parked on a gate: the agent is idle and the ball is with the
  // user, so every "generating" affordance must stand down.
  const awaitingUserDecision = useStreamStore((state) =>
    awaitsUserDecision(sessionId ? state.streams[sessionId]?.blocks : undefined),
  );

  // Pending browser/terminal captures — previewed in the composer and attached
  // to the next chat send.
  const [pendingCaptures, setPendingCaptures] = useState<ComposerAttachment[]>([]);
  // Per-instance browser tab state (keyed by the RightPane tab id) so each
  // "Browser" tab renders its own live title + favicon + spinner.
  const [browserTabs, setBrowserTabs] = useState<Record<string, BrowserTabState>>({});
  const [editingSources, setEditingSources] = useState(false);

  // Files tab + per-file tabs. Opening a file expands the pane first, so the
  // gesture works even when the user has it collapsed.
  const fileTabs = useFileTabs({
    workspaceId: chat?.workspaceId,
    requestFocus: dock.requestFocus,
    openPane: () => setRightPaneOpen(true),
    onEditSources: () => setEditingSources(true),
  });

  // Closing a tab for good drops whatever that tab remembered.
  const forgetFileTab = fileTabs.forgetTab;
  const forgetBrowserTab = dock.forgetBrowserTab;
  const handleRightPaneTabClose = useCallback(
    (tab: { id: string; type: string }) => {
      if (tab.type === 'files') {
        forgetFileTab(tab.id);
        return;
      }
      if (tab.type !== 'browser') return;
      forgetBrowserTab(tab.id);
      setBrowserTabs((prev) => {
        if (!(tab.id in prev)) return prev;
        const next = { ...prev };
        delete next[tab.id];
        return next;
      });
    },
    [forgetBrowserTab, forgetFileTab],
  );

  const isOrchestrator = view.isOrchestrator;
  // W29 — the panel list is a ledger decision, not a literal. A surface that
  // declares it cannot render the browser or computer live view must not be
  // offered a tab for it; see `platform/surfaceCapabilities.ts`.
  const dockTypes = useMemo(
    () => dockTabTypes({ computerUseEnabled: view.computerUseEnabled, isOrchestrator }),
    [view.computerUseEnabled, isOrchestrator],
  );
  const addableDockTabs = useMemo(() => dockAddableTabTypes(dockTypes), [dockTypes]);
  /** Workers running or waiting to start — the tab's live count badge. */
  const runningTaskCount = useRunningBackgroundTaskCount(sessionId);

  const {
    activePlanId,
    changesFocusFile,
    openChangesTab,
    agentConsoleCallId,
    closeAgentShell,
    openWidgetTab,
    browserUrlScopeKey,
  } = dock;
  const widgetTitlesKey = stream.widgetTitlesKey;

  // Right-pane tabs — memoised so a token frame (which changes `stream`,
  // deliberately excluded from these deps) does not rebuild all ~10 panel
  // configs and defeat RightPane's own per-panel memoisation (see the
  // `Component`/`render` doc comment in RightPane.tsx). Anything that needs
  // the live stream (the terminal's shell console, the widget tab's live
  // label) reads it narrowly instead of closing over a value captured here —
  // `AgentShellPanel` subscribes itself, and `widgetLabel` below reads a
  // fresh snapshot only when `widgetTitlesKey` actually changes.
  // The Changes tab's props, memoised so streamed tokens never re-render it.
  const changesDockProps = useMemo<ChangesPanelProps>(
    () => ({
      ...(chat?.workspaceId ? { workspaceId: chat.workspaceId } : {}),
      ...(chatId ? { chatId } : {}),
      ...(chat?.name ? { scmHint: chat.name } : {}),
      enableReview: true,
      // Threads are scoped to the chat; the send target is also the chat, so
      // "Send all" posts the batch as a new user turn.
      reviewScope: { scope: 'chat', scopeId: chatId ?? '' },
      ...(chatId ? { reviewTarget: { kind: 'chat', chatId } } : {}),
      focusFile: changesFocusFile,
    }),
    [chat?.workspaceId, chatId, chat?.name, changesFocusFile],
  );

  const tabs = useMemo<DockRegistry>(() => {
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

    const registry: DockRegistry = {
      changes: {
        label: 'Changes',
        description: 'Files & changes for this chat',
        icon: 'changes',
        pinned: true,
        // Reads its props from ChangesDockContext (provided below).
        Component: ChangesDockPanel,
      },
      // D-27: Files is ONE pinned tab (the tree); opened files get `file` tabs.
      files: {
        render: fileTabs.filesTab.render!,
        label: 'Files',
        description: fileTabs.filesTab.description ?? 'Browse every file in the workspace',
        icon: 'files',
        pinned: true,
      },
      file: {
        render: fileTabs.fileTab.render!,
        label: 'File',
        icon: 'file',
        allowMultiple: true,
        maxInstances: CHAT_DOCK_TAB_CAPS.file,
        ...(fileTabs.fileTab.getTabLabel ? { getTabLabel: fileTabs.fileTab.getTabLabel } : {}),
      },
      browser: {
        label: 'Browser',
        description: 'Integrated browser for this chat',
        icon: 'browser',
        pinned: true,
        allowMultiple: true,
        maxInstances: CHAT_DOCK_TAB_CAPS.browser,
        getTabLabel: ({ id, index }) => {
          const t = (browserTabs[id]?.title ?? '').trim();
          return t || (index <= 1 ? 'Browser' : `Browser ${index}`);
        },
        getTabDot: ({ id }) => (browserTabs[id]?.loading ? { tone: 'run', label: 'Loading' } : undefined),
        disabled: !chat?.workspaceId,
        disabledReason: 'No workspace for this chat',
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
        icon: 'terminal',
        pinned: true,
        allowMultiple: true,
        getTabLabel: ({ index }) => (index <= 1 ? 'Terminal' : `Terminal ${index}`),
        // P2-54 — terminals are the one uncapped WebGL-context consumer:
        // each xterm instance takes a WebGL context, and browsers hand out
        // ~16 per page before evicting the oldest, at which point earlier
        // terminals silently stop painting. Also one PTY per tab on the
        // host. 4 is above any observed real use of parallel shells.
        maxInstances: CHAT_DOCK_TAB_CAPS.terminal,
        disabled: !chat?.workspaceId,
        disabledReason: 'No workspace for this chat',
        render: (ctx) => (
          <React.Suspense fallback={<PanelFallback />}>
            {agentConsoleCallId != null ? (
              <AgentShellPanel
                sessionId={sessionId}
                messages={messages}
                callId={agentConsoleCallId}
                onClose={closeAgentShell}
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
        icon: 'computer',
        pinned: true,
        disabled: !chat?.workspaceId,
        disabledReason: 'No workspace for this chat',
        Component: ChatComputerDockPanel,
      },
      widget: {
        label: 'Widget',
        description: 'Agent-rendered interactive widgets in a full-page surface',
        icon: 'widgets',
        // One tab per widget instance — several widgets in one chat must
        // not compete for a single surface.
        allowMultiple: true,
        maxInstances: CHAT_DOCK_TAB_CAPS.widget,
        disabled: !sessionId,
        disabledReason: 'Start the chat to enable widgets',
        getTabLabel: ({ id }) => {
          const instanceId = parseWidgetTabId(id);
          return instanceId ? widgetLabel(instanceId) : 'Widgets';
        },
        Component: ChatWidgetDockPanel,
      },
      tasks: {
        label: 'Tasks',
        description: 'Background agent tasks spawned by this orchestrator chat',
        icon: 'tasks',
        pinned: true,
        // Live count of workers running or waiting to start, so the tab says
        // there is something to look at without being opened.
        getTabCount: () => (runningTaskCount > 0 ? runningTaskCount : undefined),
        Component: ChatTasksDockPanel,
      },
      // PLN-01 — the plan document surface. Auto-opens when the agent asks
      // for a review; also addable so a user can revisit an older plan.
      plan: {
        label: 'Plan',
        description: 'Review, edit and approve the agent’s implementation plan',
        icon: 'plan',
        Component: ChatPlanDockPanel,
      },
    };
    // Only the types this chat has on this surface (Tasks for orchestrators, Computer when enabled …).
    return Object.fromEntries(dockTypes.flatMap((type) => (registry[type] ? [[type, registry[type]]] : [])));
  }, [
    dockTypes,
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
    closeAgentShell,
    messages,
    isOrchestrator,
    runningTaskCount,
    widgetTitlesKey,
    changesFocusFile,
  ]);

  // Transcript slots for blocks whose renderers are still legacy parts.
  const renderTranscriptWidget = useCallback(
    (block: WidgetBlock, sid: string) => <WidgetFrame block={block} sessionId={sid} />,
    [],
  );
  const renderTranscriptScm = useCallback(
    (block: ScmResultBlock) => (
      <ScmResultCard
        result={block.result}
        {...(chat?.workspaceId ? { workspaceId: chat.workspaceId } : {})}
        {...(chatId ? { chatId } : {})}
      />
    ),
    [chat?.workspaceId, chatId],
  );
  const requestDockFocus = dock.requestFocus;
  const focusDockTab = useCallback(
    (type: 'browser' | 'tasks') => {
      setRightPaneOpen(true);
      requestDockFocus({ type, token: Date.now() });
    },
    [requestDockFocus, setRightPaneOpen],
  );

  // What the Tasks / Computer / Plan / Widget dock panels read (their
  // registry `Component`s take only the tab instance).
  const chatDock = useMemo<ChatDockContextValue>(
    () => ({ chatId, chat, workspaceId: chat?.workspaceId, sessionId, activePlanId, openWidgetTab }),
    [chatId, chat, sessionId, activePlanId, openWidgetTab],
  );

  // Loading
  if (!chatId) {
    navigate('/');
    return null;
  }

  // Only the chat record gates the shell: the composer needs `chat.sessionId`,
  // nothing else. Waiting on the message page too made the input box appear
  // only after the slower of two round trips — the transcript now streams in
  // under its own skeleton while the rest of the page is already interactive.
  if (workspace.chatLoading) {
    return <ChatMessageSkeleton />;
  }

  if (workspace.chatError || !chat) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-[var(--color-destructive)]">Chat not found</p>
        <Button variant="unstyled"
          onClick={() => navigate('/')}
          className="text-sm text-[var(--color-primary)] underline"
        >
          Go back
        </Button>
      </div>
    );
  }

  return (
    <PathRootsContext.Provider value={workspace.pathRoots}>
    <ChangesDockContext.Provider value={changesDockProps}>
    <ChatDockContext.Provider value={chatDock}>
    <div className="relative flex h-full">
      {/* The right dock (D-27) lays out the main chat column beside it. */}
      <Dock
        open={rightPaneOpen}
        onOpenChange={setRightPaneOpen}
        storageKey={dock.dockStorageKey}
        layoutStorageKey={CHAT_DOCK_KEYS.layout}
        defaultTabType={defaultDockTab()}
        addableTabTypes={addableDockTabs}
        focusTabRequest={dock.focusRequest}
        onTabClose={handleRightPaneTabClose}
        tabs={tabs}
        main={
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

      {/* Where this chat came from. A fork starts as a copy of its parent —
          the history up to the branch point, and the files as they were — in a
          workspace and on a branch of its own. The link back is how you find
          the chat it diverged from. */}
      {chat.forkedFromChatId && (
        <ForkProvenanceChip parentChatId={chat.forkedFromChatId} />
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

      {/* Transcript — the transcript kit (P4-07); LiveTurn inside owns the
          per-token subscription, so this page does not. */}
      <ChatTranscript
        view={view}
        agentName={chat.agentSnapshot?.driving?.name ?? activeHarnessLabel ?? 'Agent'}
        harnessLabel={activeHarnessLabel}
        canRewind={canRewind}
        loadingFallback={<ChatMessageSkeleton />}
        renderWidget={renderTranscriptWidget}
        renderScmResult={renderTranscriptScm}
        focusDockTab={focusDockTab}
      />

      {/* Input — only for active chats (the composer block with this page's send) */}
      {isChatActive && sessionId && (
        <>
          <Composer
            sessionId={sessionId}
            chat={chat}
            onOpenTasks={() => {
              setRightPaneOpen(true);
              dock.requestFocus({ type: 'tasks', token: Date.now() });
            }}
            // D-29: typing is never blocked — while a turn runs, Send is Stop
            // and the draft simply waits (no queue).
            disabled={false}
            placeholder="What feature are you dreaming up?"
            selectedModel={workspace.effectiveModel}
            onModelChange={workspace.changeModel}
            reasoningEffort={workspace.reasoningEffort}
            onReasoningEffortChange={workspace.changeReasoningEffort}
            contextTier={workspace.contextTier}
            onContextTierChange={workspace.changeContextTier}
            gitRepositories={workspace.gitRepositories}
            projectId={chat?.projectId}
            codebaseIds={workspace.selectedCodebaseIds}
            workspaceId={chat?.workspaceId}
            {...(chat?.workspacePrep ? { workspacePrep: chat.workspacePrep } : {})}
            onRetryWorkspacePrep={workspace.retryWorkspacePrep}
            workspacePrepRetrying={workspace.workspacePrepRetrying}
            onEditSources={() => setEditingSources(true)}
            showModelSelector={true}
            isStreaming={isCopilotWorking}
            pendingCaptures={pendingCaptures}
            promptHistory={promptHistory}
            {...(restoredDraft ? { restoredDraft } : {})}
            onRemovePendingCapture={(id) => setPendingCaptures((prev) => prev.filter((c) => c.id !== id))}
            onBuiltinCommand={dock.runBuiltinCommand}
            stopState={stop}
            onStop={stop.press}
            customSendFn={async ({ prompt, attachments, mode }) => {
              const mergedAttachments = pendingCaptures.length
                ? [...attachments, ...pendingCaptures.map((c) => c.file)]
              : attachments;
            await view.sendPrompt({
              prompt,
              attachments: mergedAttachments,
              ...(mode ? { mode } : {}),
            });
            if (pendingCaptures.length) setPendingCaptures([]);
          }}
          agentMode={gates.agentMode}
          onAgentModeChange={(mode) => {
            gates.setAgentMode(mode);
            // Persist as the chat's sticky default, matching how the model and
            // reasoning-effort pickers behave.
            workspace.persistAgentMode(mode);
          }}
          showAgentModePicker={!chat?.parentChatId}
          {...(chat?.agentSnapshot?.driving?.name
            ? { agentName: chat.agentSnapshot.driving.name }
            : {})}
          pendingInteractionLabel={gates.pendingInteractionLabel}
          onCancelPendingInteraction={stopRewind.cancelPendingInteraction}
          aboveComposer={
            <>
              {/* Workers outlive the orchestrator's turn: keep the strip up while any run. */}
              <LiveActivityStrip sessionId={sessionId} active={isCopilotWorking || runningTaskCount > 0} />
              <ChatChangesTray
                workspaceId={chat?.workspaceId}
                sessionId={sessionId}
                streaming={isCopilotWorking}
                onOpenChanges={openChangesTab}
              />
            </>
          }
        />
        </>
      )}
      </div>
        }
      />

      {/* Source editor — reachable from the preparation banner and from the
          Sources block at the top of the Files tab. */}
      <EditSourcesDialog
        open={editingSources}
        onClose={() => setEditingSources(false)}
        chat={chat}
      />
    </div>
    </ChatDockContext.Provider>
    </ChangesDockContext.Provider>
    </PathRootsContext.Provider>
  );
}

export { ChatPage as ChatPageComponent };

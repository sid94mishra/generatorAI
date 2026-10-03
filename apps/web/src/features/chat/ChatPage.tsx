// ────────────────────────────────────────────────────────────────
// F-chat-00 ChatPage — the chat workspace (`/chats/:id`) on T-04 Workspace
// (P4-12; boards Main, ChatLight, ChatNarrow, Chat*; D-21, D-27).
//
//   header   ChatHeader (F-chat-01): breadcrumb, status, fork provenance,
//            branch chip, More (Open in editor, Rename, Copy transcript, Fork,
//            Archive), dock toggle
//   main     the archived banner + ChatTranscript (F-chat-02, TranscriptView)
//   bottom   the composer block with the live-activity line and ChangesTray
//   dock     blocks/dock Dock (DockFrame owns the split, the <1200px sheet,
//            Maximize); panels read their contexts, not closures
//
// The logic lives in `useChatView` (hooks/); this file is JSX plus the page's
// own UI state (pending captures, browser tab titles) and the dock registry.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { awaitsUserDecision, type ScmResultBlock, type WidgetBlock } from '@generatorai/client-core';
import { composerPromptPlaceholder, harnessProviderLabel } from '@generatorai/shared/ui-contract';
import { useMarkChatRead } from '@/hooks/chatListQueries.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { useEditSourcesStore } from '@/stores/editSourcesStore.js';
import { parseWidgetTabId } from '@/lib/widgetTabId.js';
import { PathRootsContext } from '@/blocks/changes/changePaths.js';
import { ChangesDockContext, ChangesDockPanel } from '@/blocks/changes/ChangesDockPanel.js';
import type { ChangesPanelProps } from '@/blocks/changes/ChangesPanel.js';
import { ChangesTray, Composer, type ComposerAttachment } from '@/blocks/composer/index.js';
import { Dock, useDockOpen, useSurfaceDockTabs, type DockRegistry } from '@/blocks/dock/index.js';
import { FileDockPanel, FilesDockPanel, FilesDockProvider, useFileTabs } from '@/blocks/files/useFileTabs.js';
import { SourcesBlock } from '@/blocks/files/SourcesBlock.js';
import { TerminalDockPanel, TerminalDockProvider, terminalTabLabel, type TerminalDockContextValue } from '@/blocks/terminal/terminalDock.js';
import { BrowserDockPanel, BrowserDockProvider, browserDockTabLabel, type BrowserDockContextValue } from '@/blocks/browser/browserDock.js';
import type { BrowserTabState } from '@/blocks/browser/useBrowserTabState.js';
import { ScmResultCard } from '@/blocks/scm/ScmResultCard.js';
import { WidgetFrame } from '@/blocks/widgets/index.js';
import { Workspace } from '@/ui/templates/Workspace/Workspace.js';
import { Banner } from '@/ui/patterns/Banner/Banner.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Icon } from '@/ui/icons/Icon.js';
import { ChatHeader } from './components/ChatHeader.js';
import { ChatTranscript } from './components/ChatTranscript.js';
import { LiveActivityLine, useRunningBackgroundTaskCount } from './components/LiveActivityLine.js';
import {
  ChatComputerDockPanel,
  ChatDockContext,
  ChatPlanDockPanel,
  ChatTasksDockPanel,
  ChatWidgetDockPanel,
  type ChatDockContextValue,
} from './dock/chatDockPanels.js';
import { CHAT_DOCK_KEYS, CHAT_DOCK_TAB_CAPS } from './hooks/useChatDockRouting.js';
import { useChatView } from './hooks/useChatView.js';
import { useModelLabel } from '@/blocks/model-picker/index.js';

/** Placeholder turns while the chat record or its messages load (decorative; the region says "Loading"). */
function ChatSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading chat"
      data-testid="chat-skeleton"
      className="mx-auto flex w-full max-w-190 flex-col gap-6 px-7 py-5"
    >
      {['62%', '100%', '48%'].map((width, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton width={i % 2 ? 96 : 80} />
          <Skeleton shape="block" className="h-row" width={width} />
        </div>
      ))}
    </div>
  );
}

export function ChatPage() {
  const { id: chatId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // The right dock (D-27) — tabs are managed inside `Dock`; here we only track
  // whether it is open (collapsed, never unmounted, when closed).
  const [dockOpen, setDockOpen, toggleDock] = useDockOpen(CHAT_DOCK_KEYS.open, false);
  const view = useChatView({ chatId, dockOpen, setDockOpen, toggleDock });
  // MG-02 / MD-112: the chat is read while it is open (D-83).
  useMarkChatRead(chatId);
  const { chat, sessionId, workspace, stream, transcript, gates, stopRewind, dock } = view;
  const { isWorking } = stream;
  const { messages, promptHistory } = transcript;
  const { stop, canRewind, restoredDraft } = stopRewind;
  const activeHarnessLabel = workspace.harnessProvider ? harnessProviderLabel(workspace.harnessProvider) : null;
  const modelLabel = useModelLabel(workspace.effectiveModel);

  // The turn is parked on a gate: the agent is idle and the ball is with the user.
  const awaitingUserDecision = useStreamStore((state) =>
    awaitsUserDecision(sessionId ? state.streams[sessionId]?.blocks : undefined),
  );
  const streamStatus = useStreamStore((state) => (sessionId ? state.streams[sessionId]?.status : undefined));

  // Pending browser/terminal captures — previewed in the composer and attached to the next send.
  const [pendingCaptures, setPendingCaptures] = useState<ComposerAttachment[]>([]);
  // Per-instance browser tab state (keyed by dock tab id): each Browser tab's live title, favicon, spinner.
  const [browserTabs, setBrowserTabs] = useState<Record<string, BrowserTabState>>({});

  const openEditSources = useEditSourcesStore((s) => s.open);
  const editSources = useCallback(() => {
    if (chatId) openEditSources(chatId);
  }, [chatId, openEditSources]);

  // Files tab + per-file tabs. Opening a file opens the dock first; the Files
  // tab leads with the chat's Sources block.
  const filesSources = useMemo(
    () => <SourcesBlock embedded workspaceId={chat?.workspaceId} onEditSources={editSources} />,
    [chat?.workspaceId, editSources],
  );
  const openDock = useCallback(() => setDockOpen(true), [setDockOpen]);
  const fileTabs = useFileTabs({
    workspaceId: chat?.workspaceId,
    requestFocus: dock.requestFocus,
    openPane: openDock,
    sources: filesSources,
  });

  // Closing a tab for good drops whatever that tab remembered.
  const forgetFileTab = fileTabs.forgetTab;
  const forgetBrowserTab = dock.forgetBrowserTab;
  const handleDockTabClose = useCallback(
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
  // W29 — the panel list is a ledger decision: a surface that cannot render the
  // browser or computer live view is not offered a tab for it.
  const surfaceTabs = useSurfaceDockTabs({ computerUseEnabled: view.computerUseEnabled, isOrchestrator });
  const dockTypes = surfaceTabs.types;
  /** Workers running or waiting to start — the Tasks tab's live count. */
  const runningTaskCount = useRunningBackgroundTaskCount(sessionId);

  const { activePlanId, changesFocusFile, openChangesTab, agentConsoleCallId, closeAgentShell, openWidgetTab, browserUrlScopeKey } =
    dock;
  const widgetTitlesKey = stream.widgetTitlesKey;

  const addCapture = useCallback(
    (source: 'browser' | 'terminal') => (file: File) =>
      setPendingCaptures((prev) => [...prev, { id: `${source}:${Date.now()}:${file.name}`, file, source, label: file.name }]),
    [],
  );
  const onBrowserTabState = useCallback((tabId: string, s: BrowserTabState) => {
    setBrowserTabs((prev) => {
      const cur = prev[tabId];
      if (cur && cur.loading === s.loading && cur.title === s.title && cur.favicon === s.favicon && cur.url === s.url) return prev;
      return { ...prev, [tabId]: s };
    });
  }, []);
  const agentName = chat?.agentSnapshot?.driving?.name;
  const browserDock = useMemo<BrowserDockContextValue>(
    () => ({
      workspaceId: chat?.workspaceId,
      urlScopeKey: browserUrlScopeKey,
      onCapture: addCapture('browser'),
      agentBusy: isWorking,
      ...(agentName ? { agentName } : {}),
      onTabStateChange: onBrowserTabState,
    }),
    [chat?.workspaceId, browserUrlScopeKey, addCapture, isWorking, agentName, onBrowserTabState],
  );
  const terminalDock = useMemo<TerminalDockContextValue>(
    () => ({
      workspaceId: chat?.workspaceId,
      onCapture: addCapture('terminal'),
      agentBusy: isWorking,
      // A "Ran" step's terminal icon swaps the shells for the agent's commands.
      agentConsole:
        agentConsoleCallId != null ? { callId: agentConsoleCallId, sessionId, messages, onClose: closeAgentShell } : null,
    }),
    [chat?.workspaceId, addCapture, isWorking, agentConsoleCallId, sessionId, messages, closeAgentShell],
  );

  // The Changes tab's props, memoised so streamed tokens never re-render it.
  const changesDockProps = useMemo<ChangesPanelProps>(
    () => ({
      ...(chat?.workspaceId ? { workspaceId: chat.workspaceId } : {}),
      ...(chatId ? { chatId } : {}),
      ...(chat?.name ? { scmHint: chat.name } : {}),
      enableReview: true,
      // Threads are scoped to the chat; "Send all" posts the batch as a new user turn.
      reviewScope: { scope: 'chat', scopeId: chatId ?? '' },
      ...(chatId ? { reviewTarget: { kind: 'chat', chatId } } : {}),
      focusFile: changesFocusFile,
    }),
    [chat?.workspaceId, chatId, chat?.name, changesFocusFile],
  );

  // The dock registry — memoised so a token frame (which changes `stream`) does
  // not rebuild every panel def and defeat the dock's per-panel memo. Anything
  // that needs the live stream reads it narrowly (the widget label takes a
  // fresh snapshot only when `widgetTitlesKey` says a title changed).
  const tabs = useMemo<DockRegistry>(() => {
    void widgetTitlesKey;
    const widgetLabel = (instanceId: string): string => {
      const blocks = sessionId ? (useStreamStore.getState().streams[sessionId]?.blocks ?? []) : [];
      const block = blocks.find((b) => b.type === 'widget' && b.instanceId === instanceId);
      return (block && block.type === 'widget' && (block.title ?? block.component)) || 'Widget';
    };
    const noWorkspace = { disabled: !chat?.workspaceId, disabledReason: 'No workspace for this chat' };

    const registry: DockRegistry = {
      changes: { label: 'Changes', description: 'Files & changes for this chat', icon: 'changes', pinned: true, Component: ChangesDockPanel },
      // D-27: Files is ONE pinned tab (the tree); opened files get `file` tabs.
      files: {
        label: 'Files',
        description: 'Browse every file in the workspace',
        icon: 'files',
        pinned: true,
        getTabLabel: fileTabs.filesTabLabel,
        Component: FilesDockPanel,
      },
      file: {
        label: 'File',
        icon: 'file',
        allowMultiple: true,
        maxInstances: CHAT_DOCK_TAB_CAPS.file,
        getTabLabel: fileTabs.fileTabLabel,
        Component: FileDockPanel,
      },
      browser: {
        label: 'Browser',
        description: 'Integrated browser for this chat',
        icon: 'browser',
        pinned: true,
        allowMultiple: true,
        maxInstances: CHAT_DOCK_TAB_CAPS.browser,
        getTabLabel: ({ id, index }) => browserDockTabLabel(browserTabs[id], index),
        getTabDot: ({ id }) => (browserTabs[id]?.loading ? { tone: 'run', label: 'Loading' } : undefined),
        ...noWorkspace,
        Component: BrowserDockPanel,
      },
      terminal: {
        label: 'Terminal',
        description: 'Integrated shell in this workspace',
        icon: 'terminal',
        pinned: true,
        allowMultiple: true,
        getTabLabel: terminalTabLabel,
        // Each xterm takes a WebGL context (browsers evict past ~16) and a PTY.
        maxInstances: CHAT_DOCK_TAB_CAPS.terminal,
        ...noWorkspace,
        Component: TerminalDockPanel,
      },
      computer: {
        label: 'Computer',
        description: 'Watch the desktop windows the agent reads and acts on',
        icon: 'computer',
        pinned: true,
        ...noWorkspace,
        Component: ChatComputerDockPanel,
      },
      widget: {
        label: 'Widget',
        description: 'Agent-rendered interactive widgets in a full-page surface',
        icon: 'widgets',
        // One tab per widget instance.
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
        getTabCount: () => (runningTaskCount > 0 ? runningTaskCount : undefined),
        Component: ChatTasksDockPanel,
      },
      // PLN-01 — auto-opens when the agent asks for a review; addable to revisit a plan.
      plan: {
        label: 'Plan',
        description: 'Review, edit and approve the agent’s implementation plan',
        icon: 'plan',
        Component: ChatPlanDockPanel,
      },
    };
    // Only the types this chat has on this surface (Tasks for orchestrators, Computer when enabled …).
    return Object.fromEntries(dockTypes.flatMap((type) => (registry[type] ? [[type, registry[type]]] : [])));
  }, [dockTypes, chat?.workspaceId, sessionId, fileTabs.filesTabLabel, fileTabs.fileTabLabel, browserTabs, runningTaskCount, widgetTitlesKey]);

  // Transcript host slots.
  const renderTranscriptWidget = useCallback((block: WidgetBlock, sid: string) => <WidgetFrame block={block} sessionId={sid} />, []);
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
      setDockOpen(true);
      requestDockFocus({ type, token: Date.now() });
    },
    [requestDockFocus, setDockOpen],
  );

  // What the Tasks / Computer / Plan / Widget panels read.
  const chatDock = useMemo<ChatDockContextValue>(
    () => ({ chatId, chat, workspaceId: chat?.workspaceId, sessionId, activePlanId, openWidgetTab }),
    [chatId, chat, sessionId, activePlanId, openWidgetTab],
  );

  if (!chatId) {
    navigate('/');
    return null;
  }

  // Only the chat record gates the page: the composer needs `chat.sessionId`,
  // nothing else; the transcript streams in under its own skeleton.
  if (workspace.chatLoading) return <ChatSkeleton />;

  if (workspace.chatError || !chat) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-ui text-err">Chat not found</p>
        <Button variant="ghost" onClick={() => navigate('/')}>
          Go back
        </Button>
      </div>
    );
  }

  // The box names who answers only for an agent or the orchestrator; a plain model
  // chat reads provider-neutral (D-90, shared with mobile).
  const composerPlaceholder = composerPromptPlaceholder({
    agent: agentName,
    orchestrator: !!chat.orchestratorMode,
    files: !!chat.workspaceId,
  });

  const composer =
    view.chatActive && sessionId ? (
      <Composer
        sessionId={sessionId}
        chat={chat}
        onOpenTasks={() => focusDockTab('tasks')}
        // D-29: typing is never blocked — while a turn runs, Send is Stop and the draft waits (no queue).
        disabled={false}
        placeholder={composerPlaceholder}
        selectedModel={workspace.effectiveModel}
        onModelChange={workspace.changeModel}
        reasoningEffort={workspace.reasoningEffort}
        onReasoningEffortChange={workspace.changeReasoningEffort}
        contextTier={workspace.contextTier}
        onContextTierChange={workspace.changeContextTier}
        gitRepositories={workspace.gitRepositories}
        projectId={chat.projectId}
        codebaseIds={workspace.selectedCodebaseIds}
        workspaceId={chat.workspaceId}
        {...(chat.workspacePrep ? { workspacePrep: chat.workspacePrep } : {})}
        onRetryWorkspacePrep={workspace.retryWorkspacePrep}
        workspacePrepRetrying={workspace.workspacePrepRetrying}
        onEditSources={editSources}
        showModelSelector={true}
        isStreaming={isWorking}
        pendingCaptures={pendingCaptures}
        promptHistory={promptHistory}
        {...(restoredDraft ? { restoredDraft } : {})}
        onRemovePendingCapture={(id) => setPendingCaptures((prev) => prev.filter((c) => c.id !== id))}
        onBuiltinCommand={dock.runBuiltinCommand}
        stopState={stop}
        onStop={stop.press}
        customSendFn={async ({ prompt, attachments, mode }) => {
          const merged = pendingCaptures.length ? [...attachments, ...pendingCaptures.map((c) => c.file)] : attachments;
          await view.sendPrompt({ prompt, attachments: merged, ...(mode ? { mode } : {}) });
          if (pendingCaptures.length) setPendingCaptures([]);
        }}
        agentMode={gates.agentMode}
        onAgentModeChange={(mode) => {
          gates.setAgentMode(mode);
          // The chat's sticky default, like the model and effort pickers.
          workspace.persistAgentMode(mode);
        }}
        showAgentModePicker={!chat.parentChatId}
        {...(agentName ? { agentName } : {})}
        pendingInteractionLabel={gates.pendingInteractionLabel}
        onCancelPendingInteraction={stopRewind.cancelPendingInteraction}
        aboveComposer={
          <>
            {/* Workers outlive the orchestrator's turn: keep the line up while any run. */}
            <LiveActivityLine sessionId={sessionId} active={isWorking || runningTaskCount > 0} />
            <ChangesTray workspaceId={chat.workspaceId} sessionId={sessionId} streaming={isWorking} onOpenChanges={openChangesTab} />
          </>
        }
      />
    ) : null;

  return (
    <PathRootsContext.Provider value={workspace.pathRoots}>
      <ChangesDockContext.Provider value={changesDockProps}>
        <ChatDockContext.Provider value={chatDock}>
          <FilesDockProvider value={fileTabs.dockContext}>
            <TerminalDockProvider value={terminalDock}>
              <BrowserDockProvider value={browserDock}>
                <Workspace
                  bare
                  data-testid="chat-workspace"
                  header={
                    <ChatHeader
                      chat={chat}
                      streamStatus={streamStatus}
                      awaitingUser={awaitingUserDecision}
                      dockOpen={dockOpen}
                      onToggleDock={toggleDock}
                    />
                  }
                  main={
                    <>
                      {/* The turn's state in words, under the header (the badge carries it too). */}
                      {isWorking ? (
                        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-line-soft px-7 py-1.5 text-small font-medium text-run">
                          {awaitingUserDecision ? <Icon concept="pause" size={14} /> : <Spinner size={14} />}
                          <span>
                            {awaitingUserDecision
                              ? 'Paused — waiting for your input'
                              : stream.isStreaming
                                ? 'Generating response...'
                                : 'Processing...'}
                          </span>
                        </div>
                      ) : null}
                      {chat.status === 'archived' ? (
                        <div className="shrink-0 px-7 pt-3">
                          <Banner tone="warn" lead="This chat has been archived" detail="You can read it, but it takes no new messages." />
                        </div>
                      ) : null}
                      {/* LiveTurn inside owns the per-token subscription, so this page does not. */}
                      <ChatTranscript
                        view={view}
                        agentName={agentName ?? activeHarnessLabel ?? 'Agent'}
                        harnessLabel={activeHarnessLabel}
                        canRewind={canRewind}
                        loadingFallback={<ChatSkeleton />}
                        renderWidget={renderTranscriptWidget}
                        renderScmResult={renderTranscriptScm}
                        focusDockTab={focusDockTab}
                      />
                    </>
                  }
                  bottom={composer}
                  dockHost={(column) => (
                    <Dock
                      open={dockOpen}
                      onOpenChange={setDockOpen}
                      storageKey={dock.dockStorageKey}
                      layoutStorageKey={CHAT_DOCK_KEYS.layout}
                      defaultTabType={surfaceTabs.defaultTab}
                      addableTabTypes={surfaceTabs.addable}
                      focusTabRequest={dock.focusRequest}
                      onTabClose={handleDockTabClose}
                      tabs={tabs}
                      main={column}
                    />
                  )}
                />
              </BrowserDockProvider>
            </TerminalDockProvider>
          </FilesDockProvider>
        </ChatDockContext.Provider>
      </ChangesDockContext.Provider>
    </PathRootsContext.Provider>
  );
}

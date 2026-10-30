// ────────────────────────────────────────────────────────────────
// useChatDockRouting — which dock tab the chat page asks for, and when.
//
// Owns the dock's persistence keys, the imperative "focus this tab" request,
// every AUTO-OPEN rule (background tasks, plan review, browser session,
// computer session, full-page widgets), the open-<tab> actions the transcript
// and composer call, and the per-tab caps. The dock frame itself (open state,
// tabs, width) stays with the dock host.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { DOCK_TAB_CAPS, dockStorageKeys, type DockLinkTab } from '@generatorai/shared/ui-contract';
import { toDisplayPath, type PathRoot } from '@/blocks/changes/changePaths.js';
import { useDockLinkParam, type DockFocusRequest } from '@/blocks/dock/index.js';
import { useBackgroundTasks } from '@/hooks/queries.js';
import {
  useBrowserSessionEvents,
  useComputerSessionEvents,
  useStartVisibleBrowser,
} from '@/hooks/chatSessionQueries.js';
import { clearBrowserTabUrl } from '@/lib/browserTabUrls.js';
import { widgetTabId } from '@/lib/widgetTabId.js';
import { useDockStore } from '@/stores/dockStore.js';
import { useStreamStore } from '@/stores/streamStore.js';

/**
 * The chat dock's persistence keys (D-27): open state and split layout are
 * global to chats; the tab list is per chat.
 */
export const CHAT_DOCK_KEYS = dockStorageKeys('chat');

/**
 * Per-type instance caps (D-27, `DOCK_TAB_CAPS`). Terminals are the one
 * WebGL-context consumer: each xterm takes a context, and browsers hand out
 * ~16 per page before evicting the oldest (earlier terminals then stop
 * painting) — plus one PTY per tab on the host. Browser tabs each hold a live
 * session; widgets one surface each; file tabs one viewer each.
 */
export const CHAT_DOCK_TAB_CAPS = DOCK_TAB_CAPS;

export type { DockFocusRequest };

export interface UseChatDockRoutingOptions {
  chatId: string | undefined;
  workspaceId: string | undefined;
  sessionId: string | undefined;
  /** Opens the dock (it may be collapsed when a tab asks to be shown). */
  setDockOpen: (open: boolean) => void;
  dockOpen: boolean;
  toggleDock: () => void;
  isOrchestrator: boolean;
  computerUseEnabled: boolean;
  /** The newest plan block awaiting review, from the narrow stream state. */
  awaitingPlanId: string | null;
  /** Changes when a full-page widget block appears or changes status. */
  widgetSurfaceKey: string;
  /** The chat's mounts, to name a changed file the way Changes does. */
  pathRoots: readonly PathRoot[];
}

export function useChatDockRouting({
  chatId,
  workspaceId,
  sessionId,
  setDockOpen,
  dockOpen,
  toggleDock,
  isOrchestrator,
  computerUseEnabled,
  awaitingPlanId,
  widgetSurfaceKey,
  pathRoots,
}: UseChatDockRoutingOptions) {
  // Register the dock with the shell: the dock.toggle command and the desktop menu checkmark.
  const setDockController = useDockStore((s) => s.setController);
  useEffect(() => {
    setDockController({ open: dockOpen, toggle: toggleDock });
    return () => setDockController(null);
  }, [dockOpen, toggleDock, setDockController]);

  /**
   * Imperative "focus this tab" token. Minted by every auto-open rule and
   * open-<tab> action; the dock focuses (or adds) the tab once per token.
   */
  const [focusRequest, setFocusRequest] = useState<DockFocusRequest | null>(null);
  const [bgTabAutoOpened, setBgTabAutoOpened] = useState(false);
  // React Router reuses the page across /chats/:id, so a focus request minted
  // for the previous conversation would otherwise open that tab in the next
  // one (e.g. Background Tasks following you into a worker chat).
  useEffect(() => {
    setFocusRequest(null);
    setBgTabAutoOpened(false);
  }, [chatId]);

  // Dock tabs are scoped to THIS chat, so three browser tabs opened in one
  // conversation do not leak into every other conversation.
  const dockStorageKey = CHAT_DOCK_KEYS.tabs(chatId ?? 'unknown');
  // Namespace for each browser tab's remembered URL (see `browserTabUrls`).
  const browserUrlScopeKey = `chat:${chatId ?? 'unknown'}`;
  /** A browser tab closed for good forgets the URL it remembered. */
  const forgetBrowserTab = useCallback(
    (tabId: string) => clearBrowserTabUrl(browserUrlScopeKey, tabId),
    [browserUrlScopeKey],
  );

  // Orchestrator mode: when the first background task appears, pop the
  // Background Tasks tab so the user sees the delegation happen. Once per chat.
  const { data: backgroundTasksData } = useBackgroundTasks(chatId, isOrchestrator);
  const backgroundTaskCount = backgroundTasksData?.tasks?.length ?? 0;
  useEffect(() => {
    if (isOrchestrator && backgroundTaskCount > 0 && !bgTabAutoOpened) {
      setBgTabAutoOpened(true);
      setDockOpen(true);
      setFocusRequest({ type: 'tasks', token: Date.now() });
    }
  }, [isOrchestrator, backgroundTaskCount, bgTabAutoOpened, setDockOpen]);

  // ── Plan ──────────────────────────────────────────────────────
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [planTabAutoOpenedFor, setPlanTabAutoOpenedFor] = useState<string | null>(null);
  const openPlanTab = useCallback(
    (planId: string) => {
      setActivePlanId(planId);
      setDockOpen(true);
      setFocusRequest({ type: 'plan', token: Date.now() });
    },
    [setDockOpen],
  );
  // Auto-open the Plan tab the first time a plan asks for review — but only
  // while the document is actually visible, matching the browser-tab guard.
  useEffect(() => {
    if (!awaitingPlanId || planTabAutoOpenedFor === awaitingPlanId) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    setPlanTabAutoOpenedFor(awaitingPlanId);
    openPlanTab(awaitingPlanId);
  }, [awaitingPlanId, planTabAutoOpenedFor, openPlanTab]);

  // ── Changes ───────────────────────────────────────────────────
  // Per-op diff icons, the end-of-turn summary card and the composer tray all
  // land here. With a path, the Changes tab opens focused on that file.
  const [changesFocusFile, setChangesFocusFile] = useState<{ path: string; token: number } | null>(null);
  const openChangesTab = useCallback(
    (filePath?: string) => {
      setDockOpen(true);
      const token = Date.now();
      setFocusRequest({ type: 'changes', token });
      if (filePath) setChangesFocusFile({ path: toDisplayPath(filePath, pathRoots), token });
    },
    [setDockOpen, pathRoots],
  );

  // ── Terminal ──────────────────────────────────────────────────
  /** Which agent shell command the Terminal tab's console is focused on. */
  const [agentConsoleCallId, setAgentConsoleCallId] = useState<string | null>(null);
  const openAgentShell = useCallback(
    (callId: string) => {
      setAgentConsoleCallId(callId);
      setDockOpen(true);
      setFocusRequest({ type: 'terminal', token: Date.now() });
    },
    [setDockOpen],
  );
  const closeAgentShell = useCallback(() => setAgentConsoleCallId(null), []);

  // ── Browser ───────────────────────────────────────────────────
  // Auto-open the Browser tab when the workspace signals a browser session
  // AND the config says the user wants to watch. On subscribe the probe is
  // strict (`visibility: 'visible'` on a ready session); a live
  // `browser.session_created` also accepts an unset visibility (the legacy
  // `enabled: true` opt-in).
  useBrowserSessionEvents(workspaceId, {
    onInitialDescriptor: (descriptor) => {
      if (!descriptor.ready) return;
      if (descriptor.config?.visibility === 'visible') {
        setDockOpen(true);
        setFocusRequest({ type: 'browser', token: Date.now() });
      }
    },
    onSessionCreated: (descriptor) => {
      const visibility = descriptor.config?.visibility;
      if (visibility === 'visible' || visibility === undefined) {
        setDockOpen(true);
        setFocusRequest({ type: 'browser', token: Date.now() });
      }
    },
  });

  // ── Computer ──────────────────────────────────────────────────
  // Pop the Computer tab when the agent starts driving the desktop, and
  // unconditionally when it asks for consent: a consent prompt inside a tab
  // nobody has open expires into a denial while the user watches an idle chat.
  useComputerSessionEvents(workspaceId, computerUseEnabled, (kind) => {
    if (kind !== 'computer.session_started' && kind !== 'computer.consent_required') return;
    setDockOpen(true);
    setFocusRequest({ type: 'computer', token: Date.now() });
  });

  // ── Widgets ───────────────────────────────────────────────────
  // One tab per full-page widget. The tab id encodes the instance, so a second
  // widget gets its OWN tab, and an instance is only ever auto-opened once.
  const seenCanvasWidgetsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Triggered by `widgetSurfaceKey` (a cheap instanceId:status signature)
    // rather than the live stream, so this only re-runs when a full-page
    // widget block appears or changes status — never per streamed token. The
    // blocks themselves are read fresh from the store.
    if (!sessionId) return;
    const blocks = useStreamStore.getState().streams[sessionId]?.blocks ?? [];
    for (const b of blocks) {
      if (b.type !== 'widget') continue;
      if (b.surface !== 'widget') continue;
      if (b.status === 'closed') continue;
      if (seenCanvasWidgetsRef.current.has(b.instanceId)) continue;
      seenCanvasWidgetsRef.current.add(b.instanceId);
      setDockOpen(true);
      setFocusRequest({
        type: 'widget',
        token: Date.now(),
        tabId: widgetTabId(b.instanceId),
      });
    }
  }, [sessionId, widgetSurfaceKey, setDockOpen]);

  const openWidgetTab = useCallback(
    (instanceId: string) => {
      setDockOpen(true);
      setFocusRequest({ type: 'widget', token: Date.now(), tabId: widgetTabId(instanceId) });
    },
    [setDockOpen],
  );

  // ── Composer built-ins ────────────────────────────────────────
  const startVisibleBrowser = useStartVisibleBrowser();
  /**
   * `/browser` starts the integrated browser in VISIBLE mode (so the agent's
   * later lazy `open_browser_page` reuses a session the user can watch) and
   * focuses the Browser tab; `/terminal` surfaces the integrated terminal.
   */
  const runBuiltinCommand = useCallback(
    async (commandId: string) => {
      if (commandId === 'builtin:browser') {
        if (workspaceId) await startVisibleBrowser(workspaceId);
        setDockOpen(true);
        setFocusRequest({ type: 'browser', token: Date.now() });
      } else if (commandId === 'builtin:terminal') {
        setDockOpen(true);
        setFocusRequest({ type: 'terminal', token: Date.now() });
      }
    },
    [workspaceId, startVisibleBrowser, setDockOpen],
  );

  // ── `?dock=<tab>` (R-4) ─────────────────────────────────────────
  // Home "Review", Needs-you rows, the palette and deep links land on a tab.
  useDockLinkParam((tab: DockLinkTab) => {
    setDockOpen(true);
    setFocusRequest({ type: tab, token: Date.now() });
  });

  return {
    dockStorageKey,
    browserUrlScopeKey,
    focusRequest,
    /** Hand to a tab host that mints its own focus requests (file tabs). */
    requestFocus: setFocusRequest,
    forgetBrowserTab,
    activePlanId,
    openPlanTab,
    changesFocusFile,
    openChangesTab,
    agentConsoleCallId,
    openAgentShell,
    closeAgentShell,
    openWidgetTab,
    runBuiltinCommand,
  };
}

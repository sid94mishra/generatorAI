// ────────────────────────────────────────────────────────────────
// SessionPanes — the chat session's swipeable pages.
//
//   Chat · Changes 3 · Tasks 2 · Terminal · Browser
//
// The heavy surfaces (Changes, Tasks, Terminal, Browser) are PAGES beside the
// transcript rather than a sheet over it, because each needs full height and
// its own gestures (plan §6.4). Files, Plan and Session info live in the
// Workbench sheet, reached from the header's single "⋯" menu — the strip no
// longer carries a second overflow button of its own.
//
// Only panes that apply are offered:
//   • Changes / Terminal / Browser need a workspace — a chat that has never
//     run has nothing to show, so they are omitted until one exists;
//   • Tasks appears for an orchestrator chat, or once any worker was spawned,
//     with the running count on the segment;
//   • Terminal and Browser without their scope render a locked page with the
//     reason and a "Request access" route rather than vanishing;
//   • Computer appears once computer use is switched on for the server (web's
//     rule); without `exec:computer` it is a locked page like the others.
//
// Pages mount lazily (`Pager` preloads one neighbour) and receive `active`,
// so a pane can pause its polling or WebView off-screen. The pager leaves
// the left 24pt to the platform back gesture and only activates on a clearly
// horizontal drag, so it never steals the transcript's vertical scroll. On
// Terminal and Browser the swipe is OFF: both are WebViews whose own
// horizontal drags (selection, page scroll) must not flip the page — the
// strip is the way out of them.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';

import { Pager, type PagerHandle } from '../../ui/Pager';
import { SegmentedControl, type Segment } from '../../ui/SegmentedControl';
import { checkFeature } from '../../../auth/featureGate';
import { useAuth } from '../../../auth/AuthProvider';
import { ChangesSection } from '../workbench/ChangesSection';
import { TasksSection } from '../workbench/TasksSection';
import { TerminalSection } from '../workbench/TerminalSection';
import { BrowserSection } from '../workbench/BrowserSection';
import { LockedPane } from './LockedPane';
import { ComputerPane, computerConsentKey } from './ComputerPane';
import { COMPUTER_SCOPE, availablePanes, computerFeature, type PaneDescriptor, type PaneId } from './paneModel';
import type { PendingConsent } from './computerModel';
import type { TasksSummary } from './useTasksSummary';

export type { PaneId, PaneDescriptor } from './paneModel';

type WithActive<P> = React.ComponentType<P & { active?: boolean }>;
const TerminalPane = TerminalSection as WithActive<React.ComponentProps<typeof TerminalSection>>;
const BrowserPane = BrowserSection as WithActive<React.ComponentProps<typeof BrowserSection>>;

/** Panes whose content owns horizontal drags; the pager swipe is off there. */
const NO_SWIPE: ReadonlySet<PaneId> = new Set<PaneId>(['terminal', 'browser']);

/** A request to open one file in the Changes pane. `nonce` re-asks for the same file. */
export interface ChangesFocus {
  path: string;
  nonce: number;
}

export interface SessionPanesProps {
  workspaceId: string | null;
  /** The chat — review threads, "send to agent" and conflict help are scoped to it. */
  chatId: string;
  /** The chat is driven by an orchestrator agent — it gets a Tasks pane up front. */
  orchestrator: boolean;
  /** Background workers, from `useTasksSummary` (the screen shares it with its menu). */
  tasksSummary: TasksSummary;
  scopes: readonly string[];
  changesCount: number;
  /** Controlled: the screen owns the pane so slash commands and the tray can switch it. */
  pane: PaneId;
  onPaneChange: (pane: PaneId) => void;
  /** A file the Changes pane should open on arrival (from a row or the tray). */
  focus: ChangesFocus | null;
  /** The transcript + composer page. */
  renderChat: () => React.ReactNode;
  /** Reports the panes on offer, so slash commands can route to them. */
  onPanesChange?: (panes: ReadonlyArray<PaneDescriptor>) => void;
  /** A turn is streaming — the browser's share toggle waits for it. */
  agentBusy?: boolean;
}

export function SessionPanes({
  workspaceId,
  chatId,
  orchestrator,
  tasksSummary,
  scopes,
  changesCount,
  pane,
  onPaneChange,
  focus,
  renderChat,
  onPanesChange,
  agentBusy = false,
}: SessionPanesProps): React.ReactElement {
  const { fetch: authFetch } = useAuth();
  const progress = useSharedValue(0);
  const pagerRef = useRef<PagerHandle | null>(null);

  // Same query key as BrowserSection's, so this is a cache read rather than
  // a second poll — it exists so the STRIP can say the browser is up without
  // the user having to open the pane to find out.
  const browserDescriptor = useQuery<{ ready?: boolean }>({
    queryKey: ['workspaces', workspaceId, 'browser', 'descriptor'] as const,
    queryFn: async () => {
      const response = await authFetch(`/api/workspaces/${workspaceId}/browser/descriptor`);
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as { ready?: boolean };
    },
    enabled: Boolean(workspaceId) && checkFeature('browser', scopes).available,
    refetchInterval: 5_000,
  });

  // Same key and shape as the composer controller's `/computer-use` read.
  const computerUse = useQuery({
    queryKey: ['computer-use-settings'],
    queryFn: async () => {
      const res = await authFetch('/api/system/computer-use');
      if (!res.ok) return { enabled: false };
      return (await res.json()) as { enabled: boolean; skillId?: string };
    },
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
  const computerUseEnabled = computerUse.data?.enabled === true;
  const holdsComputer = scopes.includes(COMPUTER_SCOPE);

  // A consent prompt blocks the agent until someone answers, so the strip
  // says one is waiting even while the Computer pane is not open. Shared key
  // with the pane, which polls faster while visible.
  const computerConsent = useQuery({
    queryKey: computerConsentKey(workspaceId),
    queryFn: async () => {
      const res = await authFetch(`/api/workspaces/${workspaceId}/computer/consent`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { pending?: PendingConsent[] };
    },
    enabled: Boolean(workspaceId) && computerUseEnabled && holdsComputer,
    refetchInterval: 5_000,
  });
  const computerNeedsAnswer = (computerConsent.data?.pending ?? []).some((p) => p.expiresAt > Date.now());

  const tasks = useMemo(
    () => ({ orchestrator, total: tasksSummary.total, running: tasksSummary.running }),
    [orchestrator, tasksSummary.total, tasksSummary.running],
  );

  const panes = useMemo(
    () =>
      availablePanes({
        workspaceId,
        scopes,
        changesCount,
        browserLive: browserDescriptor.data?.ready === true,
        tasks,
        computerUseEnabled,
        computerNeedsAnswer,
      }),
    [workspaceId, scopes, changesCount, browserDescriptor.data?.ready, tasks, computerUseEnabled, computerNeedsAnswer],
  );
  useEffect(() => {
    onPanesChange?.(panes);
  }, [panes, onPanesChange]);

  const segments = useMemo<Segment<PaneId>[]>(
    () =>
      panes.map((p) => ({
        value: p.id,
        label: p.label,
        ...(p.count !== undefined ? { count: p.count } : {}),
        ...(p.live ? { live: true } : {}),
      })),
    [panes],
  );

  // A pane that stopped applying (workspace gone) folds back to the chat.
  const index = Math.max(0, panes.findIndex((p) => p.id === pane));
  useEffect(() => {
    if (pane !== 'chat' && !panes.some((p) => p.id === pane)) onPaneChange('chat');
  }, [pane, panes, onPaneChange]);

  const terminal = checkFeature('terminal', scopes);
  const browser = checkFeature('browser', scopes);

  const onIndexChange = useCallback(
    (next: number) => {
      const target = panes[next];
      if (target) onPaneChange(target.id);
    },
    [panes, onPaneChange],
  );

  const renderPage = useCallback(
    (i: number, active: boolean): React.ReactNode => {
      const target = panes[i];
      if (!target) return null;
      switch (target.id) {
        case 'chat':
          return renderChat();
        case 'changes':
          return (
            <ChangesSection
              workspaceId={workspaceId!}
              chatId={chatId}
              focusPath={focus?.path ?? null}
              focusNonce={focus?.nonce ?? 0}
              active={active}
            />
          );
        case 'tasks':
          return <TasksSection chatId={chatId} active={active} />;
        case 'terminal':
          return terminal.available ? (
            <TerminalPane workspaceId={workspaceId!} active={active} />
          ) : (
            <LockedPane title="Terminal is not enabled" feature={terminal} scope="exec:terminal" />
          );
        case 'browser':
          return browser.available ? (
            <BrowserPane workspaceId={workspaceId!} active={active} agentBusy={agentBusy} />
          ) : (
            <LockedPane title="Browser is not enabled" feature={browser} scope="exec:browser" />
          );
        case 'computer': {
          const computer = computerFeature(scopes);
          return computer.available ? (
            <ComputerPane workspaceId={workspaceId!} active={active} />
          ) : (
            <LockedPane title="Computer use is not enabled on this device" feature={computer} scope={COMPUTER_SCOPE} />
          );
        }
        default:
          return null;
      }
    },
    [panes, renderChat, workspaceId, chatId, focus, terminal, browser, scopes, agentBusy],
  );

  return (
    <View className="flex-1">
      {panes.length > 1 ? (
        <View className="border-b border-border-muted px-4 pb-2">
          <SegmentedControl
            segments={segments}
            value={panes[index]?.id ?? 'chat'}
            onChange={(next) => {
              const i = panes.findIndex((p) => p.id === next);
              if (i >= 0) pagerRef.current?.goTo(i);
              onPaneChange(next);
            }}
            progress={progress}
            accessibilityLabel="Session panes"
          />
        </View>
      ) : null}
      <Pager
        ref={pagerRef}
        count={panes.length}
        index={index}
        onIndexChange={onIndexChange}
        renderPage={renderPage}
        progress={progress}
        preload={1}
        enabled={!NO_SWIPE.has(panes[index]?.id ?? 'chat')}
        accessibilityLabel="Session panes"
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// SessionPanes — the chat session's swipeable pages.
//
//   Chat · Changes 3 · Terminal · Browser · Computer
//
// The heavy surfaces (Changes, Terminal, Browser, Computer) are PAGES beside
// the transcript rather than a sheet over it, because each needs full height
// and its own gestures (plan §6.4). Files, Plan, Tasks, Widgets and the
// Inspector stay in the "More" sheet behind the strip's `⋯`.
//
// Only panes that apply are offered:
//   • Changes / Terminal / Browser need a workspace — a chat that has never
//     run has nothing to show, so they are omitted until one exists;
//   • Terminal and Browser without their scope render a locked page with the
//     reason and a "Request access" route rather than vanishing;
//   • Computer appears only when `exec:computer` is held.
//
// Pages mount lazily (`Pager` preloads one neighbour) and receive `active`,
// so a pane can pause its polling or WebView off-screen. The pager leaves
// the left 24pt to the platform back gesture and only activates on a clearly
// horizontal drag, so it never steals the transcript's vertical scroll.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { Ellipsis, Monitor } from 'lucide-react-native';

import { IconButton } from '../../ui/Button';
import { Pager, type PagerHandle } from '../../ui/Pager';
import { SegmentedControl, type Segment } from '../../ui/SegmentedControl';
import { EmptyState } from '../../ui/States';
import { checkFeature } from '../../../auth/featureGate';
import { useTheme } from '../../../theme/ThemeProvider';
import { ChangesSection } from '../workbench/ChangesSection';
import { TerminalSection } from '../workbench/TerminalSection';
import { BrowserSection } from '../workbench/BrowserSection';
import { LockedPane } from './LockedPane';
import { availablePanes, type PaneId } from './paneModel';

export type { PaneId, PaneDescriptor } from './paneModel';

/**
 * The Phase 3 / terminal agents add `active?: boolean` to the workbench
 * sections in place. Until every signature carries it, the pane frame types
 * the prop through this widening so it can be passed today and becomes a
 * plain prop the moment the sections declare it.
 */
type WithActive<P> = React.ComponentType<P & { active?: boolean }>;
const ChangesPane = ChangesSection as WithActive<React.ComponentProps<typeof ChangesSection>>;
const TerminalPane = TerminalSection as WithActive<React.ComponentProps<typeof TerminalSection>>;
const BrowserPane = BrowserSection as WithActive<React.ComponentProps<typeof BrowserSection>>;

export interface SessionPanesProps {
  workspaceId: string | null;
  scopes: readonly string[];
  changesCount: number;
  /** Controlled: the screen owns the pane so slash commands and the tray can switch it. */
  pane: PaneId;
  onPaneChange: (pane: PaneId) => void;
  /** A file the Changes pane should open on arrival (from a row or the tray). */
  focusedFile: string | null;
  onOpenMore: () => void;
  /** The transcript + composer page. */
  renderChat: () => React.ReactNode;
}

export function SessionPanes({
  workspaceId,
  scopes,
  changesCount,
  pane,
  onPaneChange,
  focusedFile,
  onOpenMore,
  renderChat,
}: SessionPanesProps): React.ReactElement {
  const { colors } = useTheme();
  const progress = useSharedValue(0);
  const pagerRef = useRef<PagerHandle | null>(null);

  const panes = useMemo(() => availablePanes({ workspaceId, scopes, changesCount }), [workspaceId, scopes, changesCount]);
  const segments = useMemo<Segment<PaneId>[]>(
    () => panes.map((p) => ({ value: p.id, label: p.label, ...(p.count !== undefined ? { count: p.count } : {}) })),
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
          return <ChangesPage workspaceId={workspaceId!} focusedFile={focusedFile} active={active} />;
        case 'terminal':
          return terminal.available ? (
            <TerminalPane workspaceId={workspaceId!} active={active} />
          ) : (
            <LockedPane title="Terminal is not enabled" feature={terminal} scope="exec:terminal" />
          );
        case 'browser':
          return browser.available ? (
            <BrowserPane workspaceId={workspaceId!} active={active} />
          ) : (
            <LockedPane title="Browser is not enabled" feature={browser} scope="exec:browser" />
          );
        case 'computer':
          return <ComputerPage />;
        default:
          return null;
      }
    },
    [panes, renderChat, workspaceId, focusedFile, terminal, browser],
  );

  return (
    <View className="flex-1">
      {panes.length > 1 ? (
        <View className="flex-row items-center gap-1 border-b border-border-muted px-3 pb-2 pt-1">
          <View className="flex-1">
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
          <IconButton
            accessibilityLabel="More: files, plan, tasks, widgets, inspector"
            icon={<Ellipsis size={20} color={colors.foreground} />}
            compact
            onPress={onOpenMore}
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
        accessibilityLabel="Session panes"
      />
    </View>
  );
}

/** Changes, with the in-pane file detail the section expects. */
function ChangesPage({
  workspaceId,
  focusedFile,
  active,
}: {
  workspaceId: string;
  focusedFile: string | null;
  active: boolean;
}): React.ReactElement {
  const [detail, setDetail] = useState<{ path: string; alias?: string } | null>(null);
  // A focus request from a row or the tray opens that file; a later request
  // for another file replaces it.
  useEffect(() => {
    if (focusedFile) setDetail({ path: focusedFile });
  }, [focusedFile]);
  return (
    <ChangesPane
      workspaceId={workspaceId}
      detail={detail}
      onOpenFile={(path, alias) => setDetail(alias ? { path, alias } : { path })}
      active={active}
    />
  );
}

function ComputerPage(): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View className="flex-1 justify-center">
      <EmptyState
        icon={<Monitor size={22} color={colors['muted-foreground']} />}
        title="Computer use"
        message="Watching and approving the agent operating apps on your desktop arrives with the execution surfaces phase. This device holds the permission, so the pane will appear here."
      />
    </View>
  );
}


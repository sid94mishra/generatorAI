// ────────────────────────────────────────────────────────────────
// WorkbenchSheet — one session tool, raised from the bottom.
//
// The tools used to be pages of a pager that shared the chat's screen, so the
// transcript was always one accidental swipe from being replaced and the
// strip above it cost a row of the conversation. They now open over the chat
// in the platform's own idiom for secondary work: a sheet with a grabber and
// two rests (half / full) that the user drags between, dismisses with a
// swipe, and that leaves the conversation visible behind it at half height.
//
// A strip of tool chips under the title switches tool in place, so comparing
// Changes with the Terminal is one tap, not close → index → open.
//
// Performance: only the tool on show is mounted, with one exception. Tools
// that hold a connection and are slow to rebuild (terminal WebView, browser
// screencast, computer) stay mounted — but paused (`active={false}`) and
// capped at the two most recent — while the sheet is open, so flipping back
// is instant. Closing the sheet unmounts everything; the PTY and the browser
// live on the server and re-attach on the next open.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import type { ChatSummary, StreamUsage } from '@generatorai/client-core';

import { Sheet } from '../ui/Sheet';
import { Chip } from '../ui/Chip';
import { IconButton } from '../ui/Button';
import { EmptyState } from '../ui/States';
import { checkFeature } from '../../auth/featureGate';
import { useTheme } from '../../theme/ThemeProvider';
import { FilesSection } from '../chat/workbench/FilesSection';
import { ChangesSection } from '../chat/workbench/ChangesSection';
import { TasksSection } from '../chat/workbench/TasksSection';
import { PlanSection } from '../chat/workbench/PlanSection';
import { TerminalSection } from '../chat/workbench/TerminalSection';
import { BrowserSection } from '../chat/workbench/BrowserSection';
import { InspectorSection } from '../chat/panes/InspectorSection';
import { LockedPane } from '../chat/panes/LockedPane';
import { ComputerPane } from '../chat/panes/ComputerPane';
import { COMPUTER_SCOPE, computerFeature } from '../chat/panes/paneModel';
import { TOOL_ICONS } from './toolIcons';
import { HEAVY_TOOLS, nextKeepAlive, type ToolDescriptor, type ToolId } from './workbenchModel';

type WithActive<P> = React.ComponentType<P & { active?: boolean }>;
const TerminalPane = TerminalSection as WithActive<React.ComponentProps<typeof TerminalSection>>;
const BrowserPane = BrowserSection as WithActive<React.ComponentProps<typeof BrowserSection>>;

/** A request to open one file in a tool. `nonce` re-asks for the same file. */
export interface ToolFocus {
  path: string;
  alias?: string;
  nonce: number;
}

export interface WorkbenchSheetProps {
  visible: boolean;
  onClose: () => void;
  tool: ToolId | null;
  onToolChange: (tool: ToolId) => void;
  tools: readonly ToolDescriptor[];
  workspaceId: string | null;
  scopes: readonly string[];
  /** Chat-scoped tools (review threads, plan, tasks, session) need these. */
  chatId?: string | null;
  chat?: ChatSummary | undefined;
  usage?: StreamUsage | null;
  contextTokens?: number | null;
  transportLabel?: string;
  streamKey?: string;
  planId?: string | null;
  /** A turn is streaming — the browser's share toggle waits for it. */
  agentBusy?: boolean;
  /** A file the Changes tool should open on arrival. */
  changesFocus?: ToolFocus | null;
}

interface FileDetail {
  path: string;
  alias?: string;
}

export function WorkbenchSheet({
  visible,
  onClose,
  tool,
  onToolChange,
  tools,
  workspaceId,
  scopes,
  chatId = null,
  chat,
  usage = null,
  contextTokens = null,
  transportLabel = '',
  streamKey = '',
  planId = null,
  agentBusy = false,
  changesFocus = null,
}: WorkbenchSheetProps): React.ReactElement {
  const { colors } = useTheme();
  // A file opened inside Changes / Files turns the sheet into a two-level
  // stack: the title becomes the file name and Back returns to the list.
  const [detail, setDetail] = useState<{ tool: 'changes' | 'files'; file: FileDetail } | null>(null);
  const [filesFocus, setFilesFocus] = useState<ToolFocus | null>(null);
  const [localChangesFocus, setLocalChangesFocus] = useState<ToolFocus | null>(null);
  const [keepAlive, setKeepAlive] = useState<ToolId[]>([]);
  const nonce = useRef(0);
  // The chip strip scrolls; the tool on show must be IN it. Opening Plan or
  // Session (the last chips) from the index used to leave the strip showing
  // the first four with nothing selected in view.
  const chipScroller = useRef<ScrollView | null>(null);
  const chipX = useRef<Partial<Record<ToolId, number>>>({});
  const revealChip = useCallback((id: ToolId) => {
    const x = chipX.current[id];
    if (x === undefined) return;
    chipScroller.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  }, []);
  useEffect(() => {
    if (visible && tool) revealChip(tool);
  }, [visible, tool, revealChip]);

  useEffect(() => {
    if (!visible) {
      setKeepAlive([]);
      setDetail(null);
      return;
    }
    if (tool) setKeepAlive((current) => nextKeepAlive(current, tool));
  }, [visible, tool]);

  // Switching tool always lands on that tool's root.
  useEffect(() => {
    setDetail((current) => (current && current.tool !== tool ? null : current));
  }, [tool]);

  const descriptor = tools.find((t) => t.id === tool) ?? null;
  const focus = localChangesFocus ?? changesFocus;

  const openInFiles = useCallback(
    (path: string, alias?: string) => {
      nonce.current += 1;
      setFilesFocus({ path, ...(alias ? { alias } : {}), nonce: nonce.current });
      setDetail(null);
      onToolChange('files');
    },
    [onToolChange],
  );

  const openInChanges = useCallback(
    (path: string, alias?: string) => {
      nonce.current += 1;
      setLocalChangesFocus({ path, ...(alias ? { alias } : {}), nonce: nonce.current });
      setDetail(null);
      onToolChange('changes');
    },
    [onToolChange],
  );

  const terminal = checkFeature('terminal', scopes);
  const browser = checkFeature('browser', scopes);

  const renderLight = (): React.ReactElement | null => {
    if (!tool || HEAVY_TOOLS.has(tool)) return null;
    const noWorkspace = (
      <EmptyState
        title="No workspace yet"
        message="A workspace is created the first time the agent runs here."
      />
    );
    switch (tool) {
      case 'changes':
        return workspaceId ? (
          <ChangesSection
            workspaceId={workspaceId}
            chatId={chatId}
            focusPath={focus?.path ?? null}
            focusNonce={focus?.nonce ?? 0}
            active={visible}
            onOpenInFiles={openInFiles}
            detail={detail?.tool === 'changes' ? detail.file : null}
            onOpenFile={(path, alias) => setDetail({ tool: 'changes', file: alias ? { path, alias } : { path } })}
          />
        ) : (
          noWorkspace
        );
      case 'files':
        return workspaceId ? (
          <FilesSection
            workspaceId={workspaceId}
            active={visible}
            focusPath={filesFocus?.path ?? null}
            focusAlias={filesFocus?.alias ?? null}
            onOpenInChanges={openInChanges}
            detail={detail?.tool === 'files' ? detail.file : null}
            onOpenFile={(path, alias) => setDetail({ tool: 'files', file: alias ? { path, alias } : { path } })}
          />
        ) : (
          noWorkspace
        );
      case 'tasks':
        return chatId ? <TasksSection chatId={chatId} active={visible} /> : null;
      case 'plan':
        return chatId ? (
          <PlanSection key={planId ?? 'latest'} chatId={chatId} active={visible} initialPlanId={planId} onDecided={onClose} />
        ) : null;
      case 'session':
        return (
          <InspectorSection
            chat={chat}
            usage={usage}
            contextTokens={contextTokens}
            transportLabel={transportLabel}
            streamKey={streamKey}
          />
        );
      default:
        return null;
    }
  };

  const renderHeavy = (id: ToolId, active: boolean): React.ReactElement | null => {
    if (!workspaceId) return null;
    switch (id) {
      case 'terminal':
        return terminal.available ? (
          <TerminalPane workspaceId={workspaceId} active={active} />
        ) : (
          <LockedPane title="Terminal is not enabled" feature={terminal} scope="exec:terminal" />
        );
      case 'browser':
        return browser.available ? (
          <BrowserPane workspaceId={workspaceId} active={active} agentBusy={agentBusy} />
        ) : (
          <LockedPane title="Browser is not enabled" feature={browser} scope="exec:browser" />
        );
      case 'computer': {
        const computer = computerFeature(scopes);
        return computer.available ? (
          <ComputerPane workspaceId={workspaceId} active={active} />
        ) : (
          <LockedPane title="Computer use is not enabled on this device" feature={computer} scope={COMPUTER_SCOPE} />
        );
      }
      default:
        return null;
    }
  };

  const title = useMemo(() => {
    if (detail) return detail.file.path.slice(detail.file.path.lastIndexOf('/') + 1);
    return descriptor?.label ?? 'Workbench';
  }, [detail, descriptor]);

  const heavyMounted = keepAlive.filter((id) => tools.some((t) => t.id === id));

  return (
    <Sheet
      visible={visible && tool !== null}
      onClose={onClose}
      title={title}
      detents={[0.55, 0.94]}
      initialDetent={1}
      scrollable={false}
      leading={
        detail ? (
          <IconButton
            accessibilityLabel="Back"
            icon={<ChevronLeft size={22} color={colors.foreground} />}
            onPress={() => setDetail(null)}
          />
        ) : undefined
      }
    >
      {detail || tools.length < 2 ? null : (
        <View className="border-b border-border-muted pb-2.5">
          <ScrollView
            ref={chipScroller}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            accessibilityRole="tablist"
            accessibilityLabel="Workbench tools"
          >
            {tools.map((t) => {
              const Icon = TOOL_ICONS[t.id];
              const selected = t.id === tool;
              return (
                <View
                  key={t.id}
                  onLayout={(event) => {
                    chipX.current[t.id] = event.nativeEvent.layout.x;
                    if (t.id === tool) revealChip(t.id);
                  }}
                >
                <Chip
                  label={t.count ? `${t.label} ${t.count > 99 ? '99+' : t.count}` : t.label}
                  accessibilityLabel={`${t.label}. ${t.glimpse}`}
                  icon={<Icon size={14} color={selected ? colors['primary-foreground'] : colors['muted-foreground']} />}
                  selected={selected}
                  tone="tab"
                  size="md"
                  onPress={() => onToolChange(t.id)}
                />
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}
      <View className="flex-1">
        {renderLight()}
        {heavyMounted.map((id) => {
          const active = visible && id === tool;
          return (
            <View
              key={id}
              style={[StyleSheet.absoluteFill, active ? null : styles.parked]}
              pointerEvents={active ? 'auto' : 'none'}
              accessibilityElementsHidden={!active}
              importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
            >
              {renderHeavy(id, active)}
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Parked, not unmounted: off to the side so a WebView keeps its surface.
  parked: { opacity: 0, transform: [{ translateX: -10_000 }] },
});

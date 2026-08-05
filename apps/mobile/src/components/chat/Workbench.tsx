// ────────────────────────────────────────────────────────────────
// Workbench — the mobile answer to the web right pane.
//
// The web dock has up to eight simultaneous tabs in a resizable column. A
// phone has one column, so the whole dock becomes ONE detented bottom sheet
// with a scrolling segmented header:
//
//   peek (28%)   glance at changes while reading the transcript
//   half (60%)   the working height
//   full (92%)   reading a diff or a plan
//
// Each section pushes its own detail view inside the sheet rather than
// navigating away, so dismissing the sheet always returns to the chat with
// the transcript exactly where it was.
//
// Sections the device is not permitted to use are still listed — HIG is
// explicit that hiding a destination is worse than explaining it — and render
// the reason instead of the content.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  FileDiff,
  FolderTree,
  Globe,
  ListTree,
  ScrollText,
  TerminalSquare,
} from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { Sheet } from '../ui/Sheet';
import { IconButton } from '../ui/Button';
import { Touchable } from '../ui/Touchable';
import { EmptyState, ErrorState, LoadingState, LockedState } from '../ui/States';
import { useApi } from '../../api/useApi';
import { useAuth } from '../../auth/AuthProvider';
import { checkFeature } from '../../auth/featureGate';
import { useTheme } from '../../theme/ThemeProvider';
import { ChangesSection } from './workbench/ChangesSection';
import { FilesSection } from './workbench/FilesSection';
import { PlanSection } from './workbench/PlanSection';
import { TasksSection } from './workbench/TasksSection';
import { BrowserSection } from './workbench/BrowserSection';
import { TerminalSection } from './workbench/TerminalSection';

export type WorkbenchSection =
  | 'changes'
  | 'files'
  | 'plan'
  | 'tasks'
  | 'terminal'
  | 'browser';

const SECTIONS: Array<{
  id: WorkbenchSection;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
}> = [
  { id: 'changes', label: 'Changes', Icon: FileDiff },
  { id: 'files', label: 'Files', Icon: FolderTree },
  { id: 'plan', label: 'Plan', Icon: ScrollText },
  { id: 'tasks', label: 'Tasks', Icon: ListTree },
  { id: 'terminal', label: 'Terminal', Icon: TerminalSquare },
  { id: 'browser', label: 'Browser', Icon: Globe },
];

export function Workbench({
  visible,
  onClose,
  section,
  onSectionChange,
  chatId,
  workspaceId,
}: {
  visible: boolean;
  onClose: () => void;
  section: WorkbenchSection;
  onSectionChange: (section: WorkbenchSection) => void;
  chatId: string;
  workspaceId: string | null;
}): React.ReactElement {
  const { colors } = useTheme();
  const { state } = useAuth();
  const api = useApi();

  // Detail navigation lives INSIDE the sheet. A pushed screen would unmount
  // the chat behind it and lose scroll position for what is meant to be a
  // glance at a file.
  const [detail, setDetail] = useState<{ kind: 'diff' | 'file'; path: string; alias?: string } | null>(
    null,
  );

  const scopes = state.status === 'authenticated' ? state.scopes : [];
  const terminal = checkFeature('terminal', scopes);
  const browser = checkFeature('browser', scopes);

  // Only fetched for the badge counts in the header; the sections own their
  // real queries so switching does not refetch everything.
  const changes = useQuery({
    queryKey: queryKeys.changes(workspaceId ?? ''),
    queryFn: () => api.workspaces.changes(workspaceId!),
    enabled: visible && Boolean(workspaceId),
    staleTime: 15_000,
  });

  const title = useMemo(() => {
    if (detail) return detail.path.slice(detail.path.lastIndexOf('/') + 1);
    return SECTIONS.find((s) => s.id === section)?.label ?? 'Workbench';
  }, [detail, section]);

  const body = ((): React.ReactElement => {
    if (!workspaceId && section !== 'plan' && section !== 'tasks') {
      return (
        <EmptyState
          title="No workspace yet"
          message="A workspace is created the first time the agent runs in this chat."
        />
      );
    }

    switch (section) {
      case 'changes':
        return (
          <ChangesSection
            workspaceId={workspaceId!}
            detail={detail?.kind === 'diff' ? detail : null}
            onOpenFile={(path, alias) => setDetail({ kind: 'diff', path, alias })}
          />
        );
      case 'files':
        return (
          <FilesSection
            workspaceId={workspaceId!}
            detail={detail?.kind === 'file' ? detail : null}
            onOpenFile={(path, alias) => setDetail({ kind: 'file', path, alias })}
          />
        );
      case 'plan':
        return <PlanSection chatId={chatId} />;
      case 'tasks':
        return <TasksSection chatId={chatId} />;
      case 'terminal':
        return terminal.available ? (
          <TerminalSection workspaceId={workspaceId!} />
        ) : (
          <LockedState title="Terminal is not enabled" reason={terminal.reason ?? ''} />
        );
      case 'browser':
        return browser.available ? (
          <BrowserSection workspaceId={workspaceId!} />
        ) : (
          <LockedState title="Browser is not enabled" reason={browser.reason ?? ''} />
        );
      default:
        return <ErrorState message="Unknown section" />;
    }
  })();

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        setDetail(null);
        onClose();
      }}
      title={title}
      detents={[0.28, 0.6, 0.92]}
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
      {detail ? null : (
        // Tight, and divided from the body: the section's own toolbar supplies
        // the next band of spacing, so any padding here is doubled.
        <View className="border-b border-border-muted">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0 }}
            contentContainerStyle={{
              gap: 6,
              paddingHorizontal: 12,
              paddingBottom: 8,
              alignItems: 'center',
            }}
          >
          {SECTIONS.map(({ id, label, Icon }) => {
            const selected = id === section;
            const count =
              id === 'changes' ? (changes.data?.stats.files ?? 0) : 0;
            return (
              <Touchable
                key={id}
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                haptic="select"
                onPress={() => {
                  setDetail(null);
                  onSectionChange(id);
                }}
                className={`h-9 flex-row items-center gap-1.5 rounded-full border px-3 ${
                  selected ? 'border-primary bg-accent' : 'border-border bg-raised'
                }`}
              >
                <Icon size={13} color={selected ? colors.primary : colors['muted-foreground']} />
                <Text
                  className={`text-sm font-medium ${selected ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  {label}
                </Text>
                {count > 0 ? (
                  <View className="min-w-4 items-center rounded-full bg-emphasis px-1">
                    <Text className="text-xs text-muted-foreground">{count}</Text>
                  </View>
                ) : null}
              </Touchable>
            );
          })}
          </ScrollView>
        </View>
      )}

      <View className="flex-1">{body}</View>
    </Sheet>
  );
}

export { LoadingState };

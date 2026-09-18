// ────────────────────────────────────────────────────────────────
// MoreSheet — the Workbench: Files · Plan · Tasks · Session info.
//
// What is left of the old single Workbench sheet once the heavy surfaces
// became pages (`SessionPanes`). These are reference views — glanced at
// while reading the transcript — so a detented sheet that leaves the chat
// visible underneath is still the right container for them. It is opened
// from the header's one "⋯" menu, so it is reachable on a chat that has no
// workspace (and so no pane strip) too.
//
// Widgets are not offered: the placeholder could only say "open this on
// desktop", and a destination that can never have content teaches people to
// skip the navigation (the rule `paneModel` applies to Computer). The inline
// widget row in the transcript still explains the limitation where it arises.
//
// Files pushes its detail INSIDE the sheet so dismissing always returns to
// the chat with the transcript exactly where it was.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import type { ChatSummary, StreamUsage } from '@generatorai/client-core';

import { Sheet } from '../../ui/Sheet';
import { IconButton } from '../../ui/Button';
import { SegmentedControl, type Segment } from '../../ui/SegmentedControl';
import { EmptyState } from '../../ui/States';
import { useTheme } from '../../../theme/ThemeProvider';
import { FilesSection } from '../workbench/FilesSection';
import { PlanSection } from '../workbench/PlanSection';
import { TasksSection } from '../workbench/TasksSection';
import { InspectorSection } from './InspectorSection';

export type MoreSection = 'files' | 'plan' | 'tasks' | 'inspector';

type WithActive<P> = React.ComponentType<P & { active?: boolean }>;
const FilesPane = FilesSection as WithActive<React.ComponentProps<typeof FilesSection>>;
const TasksPane = TasksSection as WithActive<React.ComponentProps<typeof TasksSection>>;

export const WORKBENCH_SECTIONS: ReadonlyArray<Segment<MoreSection>> = [
  { value: 'files', label: 'Files' },
  { value: 'plan', label: 'Plan' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'inspector', label: 'Session' },
];

export function MoreSheet({
  visible,
  onClose,
  section,
  onSectionChange,
  chatId,
  workspaceId,
  chat,
  usage,
  contextTokens,
  transportLabel,
  streamKey,
  planId = null,
}: {
  visible: boolean;
  onClose: () => void;
  section: MoreSection;
  onSectionChange: (section: MoreSection) => void;
  chatId: string;
  workspaceId: string | null;
  chat: ChatSummary | undefined;
  usage: StreamUsage | null;
  contextTokens: number | null;
  transportLabel: string;
  streamKey: string;
  /** The plan the Plan section opens on (from a plan card's "Open plan"). */
  planId?: string | null;
}): React.ReactElement {
  const { colors } = useTheme();
  const [detail, setDetail] = useState<{ path: string; alias?: string } | null>(null);

  const title = useMemo(
    () => (detail ? detail.path.slice(detail.path.lastIndexOf('/') + 1) : 'Workbench'),
    [detail],
  );

  const body = ((): React.ReactElement => {
    switch (section) {
      case 'files':
        return workspaceId ? (
          <FilesPane
            workspaceId={workspaceId}
            detail={detail}
            onOpenFile={(path, alias) => setDetail(alias ? { path, alias } : { path })}
            active={visible}
          />
        ) : (
          <EmptyState title="No workspace yet" message="A workspace is created the first time the agent runs in this chat." />
        );
      case 'plan':
        // Keyed on the requested plan so "Open plan" on a newer card lands on it.
        return <PlanSection key={planId ?? 'latest'} chatId={chatId} active={visible} initialPlanId={planId} />;
      case 'tasks':
        return <TasksPane chatId={chatId} active={visible} />;
      case 'inspector':
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
        return <EmptyState title="Nothing here" />;
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
      detents={[0.6, 0.92]}
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
        <View className="border-b border-border-muted px-4 pb-3">
          <SegmentedControl
            segments={WORKBENCH_SECTIONS}
            value={section}
            onChange={(next) => {
              setDetail(null);
              onSectionChange(next);
            }}
            accessibilityLabel="Workbench sections"
          />
        </View>
      )}
      <View className="flex-1">{body}</View>
    </Sheet>
  );
}

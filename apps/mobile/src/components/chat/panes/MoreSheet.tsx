// ────────────────────────────────────────────────────────────────
// MoreSheet — Files · Plan · Tasks · Widgets · Inspector.
//
// What is left of the old single Workbench sheet once the heavy surfaces
// became pages (`SessionPanes`). These are reference views — glanced at
// while reading the transcript — so a detented sheet that leaves the chat
// visible underneath is still the right container for them.
//
// Files pushes its detail INSIDE the sheet so dismissing always returns to
// the chat with the transcript exactly where it was.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ChevronLeft, FolderTree, Gauge, LayoutGrid, ListTree, ScrollText } from 'lucide-react-native';
import type { ChatSummary, StreamUsage } from '@generatorai/client-core';

import { Sheet } from '../../ui/Sheet';
import { IconButton } from '../../ui/Button';
import { Touchable } from '../../ui/Touchable';
import { EmptyState } from '../../ui/States';
import { MAX_SCALE } from '../../ui/accessibility';
import { useTheme } from '../../../theme/ThemeProvider';
import { FilesSection } from '../workbench/FilesSection';
import { PlanSection } from '../workbench/PlanSection';
import { TasksSection } from '../workbench/TasksSection';
import { InspectorSection } from './InspectorSection';

export type MoreSection = 'files' | 'plan' | 'tasks' | 'widgets' | 'inspector';

type WithActive<P> = React.ComponentType<P & { active?: boolean }>;
const FilesPane = FilesSection as WithActive<React.ComponentProps<typeof FilesSection>>;
const PlanPane = PlanSection as WithActive<React.ComponentProps<typeof PlanSection>>;
const TasksPane = TasksSection as WithActive<React.ComponentProps<typeof TasksSection>>;

const SECTIONS: Array<{
  id: MoreSection;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
}> = [
  { id: 'files', label: 'Files', Icon: FolderTree },
  { id: 'plan', label: 'Plan', Icon: ScrollText },
  { id: 'tasks', label: 'Tasks', Icon: ListTree },
  { id: 'widgets', label: 'Widgets', Icon: LayoutGrid },
  { id: 'inspector', label: 'Inspector', Icon: Gauge },
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
}): React.ReactElement {
  const { colors } = useTheme();
  const [detail, setDetail] = useState<{ path: string; alias?: string } | null>(null);

  const title = useMemo(() => {
    if (detail) return detail.path.slice(detail.path.lastIndexOf('/') + 1);
    return SECTIONS.find((s) => s.id === section)?.label ?? 'More';
  }, [detail, section]);

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
        return <PlanPane chatId={chatId} active={visible} />;
      case 'tasks':
        return <TasksPane chatId={chatId} active={visible} />;
      case 'widgets':
        return (
          <EmptyState
            icon={<LayoutGrid size={22} color={colors['muted-foreground']} />}
            title="Widgets"
            message="Interactive widgets run in a sandboxed frame this app cannot host yet. Open the chat on desktop or web to use them."
          />
        );
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
        <View className="border-b border-border-muted">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0 }}
            contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingBottom: 8, alignItems: 'center' }}
          >
            {SECTIONS.map(({ id, label, Icon }) => {
              const selected = id === section;
              return (
                <Touchable
                  key={id}
                  accessibilityLabel={label}
                  a11yRole="tab"
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
                    maxFontSizeMultiplier={MAX_SCALE.chrome}
                    className={`text-sm font-medium ${selected ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    {label}
                  </Text>
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

// ────────────────────────────────────────────────────────────────
// Workbench › Tasks.
//
// Workers an orchestrator chat has spawned. Read-only: cancelling a worker is
// a `write` operation this device is not granted, and the row says so rather
// than offering a button that would 403.
//
// Polls while anything is in flight and stops when everything has settled —
// a phone that keeps polling a finished list is just draining the battery.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ListTree } from 'lucide-react-native';
import { queryKeys, type BackgroundTaskSummary } from '@generatorai/client-core';

import { Badge, type Tone } from '../../ui/primitives';
import { Spinner, EmptyState, ErrorState } from '../../ui/States';
import { SkeletonList } from '../../ui/Skeleton';
import { PlainScroll } from '../../ui/Screen';
import { useTheme } from '../../../theme/ThemeProvider';
import { useApi } from '../../../api/useApi';

const ACTIVE = new Set(['spawned', 'running', 'reviewing', 'queued']);

function tone(status: string): Tone {
  if (status === 'completed' || status === 'done') return 'success';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'cancelled') return 'neutral';
  if (ACTIVE.has(status)) return 'info';
  return 'neutral';
}

export function TasksSection({ chatId }: { chatId: string }): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();

  const tasks = useQuery({
    queryKey: queryKeys.chatTasks(chatId),
    queryFn: () => api.chats.backgroundTasks(chatId),
    refetchInterval: (query) => {
      const list = query.state.data?.tasks ?? [];
      return list.some((t: BackgroundTaskSummary) => ACTIVE.has(t.status)) ? 4_000 : false;
    },
  });

  if (tasks.isLoading) return <View className="p-4"><SkeletonList rows={3} /></View>;
  if (tasks.isError) {
    return <ErrorState message="Could not load background tasks." onRetry={() => void tasks.refetch()} />;
  }

  const list = tasks.data?.tasks ?? [];
  if (list.length === 0) {
    return (
      <EmptyState
        title="No background tasks"
        message="Orchestrator chats delegate work to sub-agents. Any it spawns appear here."
        icon={<ListTree size={22} color={colors['muted-foreground']} />}
      />
    );
  }

  return (
    <PlainScroll onRefresh={() => void tasks.refetch()} refreshing={tasks.isFetching}>
      {list.map((task) => (
        <View
          key={task.taskId}
          className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3"
        >
          <View className="flex-1 gap-1">
            <Text numberOfLines={1} className="text-md font-medium text-foreground">
              {task.taskName}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {task.model ?? 'default model'}
              {task.reviewRounds > 0
                ? ` · ${task.reviewRounds} review round${task.reviewRounds === 1 ? '' : 's'}`
                : ''}
            </Text>
          </View>
          {ACTIVE.has(task.status) ? <Spinner /> : null}
          <Badge label={task.status} tone={tone(task.status)} />
        </View>
      ))}
    </PlainScroll>
  );
}

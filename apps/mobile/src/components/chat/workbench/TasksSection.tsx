// ────────────────────────────────────────────────────────────────
// Workbench › Tasks.
//
// Workers an orchestrator chat has spawned: status, model, review rounds,
// and — on expand — the worker's digest (summary, findings, artifacts,
// risks, open questions) from `GET /chats/:id/background-tasks/:taskId`.
// "Open worker chat" pushes the worker's own chat (its task id IS its chat
// id, the way web navigates). Cancel is gated on `write:chats`.
//
// Live: the chat stream invalidates `chatTasks` on task events, so polling
// is only a fallback while something is in flight and the pane is active.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronDown, ChevronRight, ExternalLink, ListTree } from 'lucide-react-native';
import { queryKeys, type BackgroundTaskSummary } from '@generatorai/client-core';

import { Badge, type Tone } from '../../ui/primitives';
import { Button } from '../../ui/Button';
import { ConfirmSheet } from '../../ui/ActionSheet';
import { Touchable } from '../../ui/Touchable';
import { Spinner, EmptyState, ErrorState, LoadingState } from '../../ui/States';
import { SkeletonList } from '../../ui/Skeleton';
import { PlainScroll } from '../../ui/Screen';
import { useToast } from '../../ui/Toast';
import { haptics } from '../../ui/haptics';
import { useTheme } from '../../../theme/ThemeProvider';
import { useApi } from '../../../api/useApi';
import { useTaskExtras } from '../../review/api';
import { useCapability } from '../../review';

const ACTIVE = new Set(['spawned', 'running', 'reviewing', 'queued', 'needs_review']);

const STATUS_LABEL: Record<string, string> = {
  running: 'Running',
  needs_review: 'Needs review',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  spawned: 'Starting',
};

function tone(status: string): Tone {
  if (status === 'completed' || status === 'done') return 'success';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'needs_review') return 'warning';
  if (status === 'cancelled') return 'neutral';
  if (ACTIVE.has(status)) return 'info';
  return 'neutral';
}

export function TasksSection({ chatId, active = true }: { chatId: string; active?: boolean }): React.ReactElement {
  const api = useApi();
  const extras = useTaskExtras();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const cancelCap = useCapability('cancelTask');
  const [open, setOpen] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<BackgroundTaskSummary | null>(null);

  const tasks = useQuery({
    queryKey: queryKeys.chatTasks(chatId),
    queryFn: () => api.chats.backgroundTasks(chatId),
    subscribed: active,
    refetchInterval: (query) => {
      if (!active) return false;
      const list = query.state.data?.tasks ?? [];
      return list.some((t: BackgroundTaskSummary) => ACTIVE.has(t.status)) ? 4_000 : false;
    },
  });

  const cancel = useMutation({
    mutationFn: (taskId: string) => extras.cancel(chatId, taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatTasks(chatId) });
      toast({ message: 'Worker cancelled', tone: 'success' });
    },
    onError: (err) => toast({ message: err instanceof Error ? err.message : 'Could not cancel', tone: 'error' }),
  });

  if (tasks.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={3} />
      </View>
    );
  }
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
    <>
      <PlainScroll onRefresh={() => void tasks.refetch()} refreshing={tasks.isFetching}>
        {list.map((task) => {
          const isOpen = open === task.taskId;
          const running = ACTIVE.has(task.status);
          return (
            <View key={task.taskId} className="rounded-2xl border border-border bg-card">
              <Touchable
                accessibilityLabel={`${task.taskName}, ${STATUS_LABEL[task.status] ?? task.status}`}
                accessibilityState={{ expanded: isOpen }}
                haptic="tap"
                scale="none"
                onPress={() => setOpen(isOpen ? null : task.taskId)}
                className="flex-row items-center gap-3 px-3.5 py-3"
              >
                {isOpen ? (
                  <ChevronDown size={14} color={colors['muted-foreground']} />
                ) : (
                  <ChevronRight size={14} color={colors['muted-foreground']} />
                )}
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
                {running ? <Spinner /> : null}
                <Badge label={STATUS_LABEL[task.status] ?? task.status} tone={tone(task.status)} />
              </Touchable>
              {isOpen ? (
                <View className="gap-2 border-t border-border-muted px-3.5 pb-3 pt-2">
                  <TaskDigestView chatId={chatId} taskId={task.taskId} active={active} />
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label="Open worker chat"
                      size="sm"
                      variant="secondary"
                      icon={<ExternalLink size={14} color={colors.foreground} />}
                      onPress={() => router.push({ pathname: '/chats/[id]', params: { id: task.taskId } })}
                    />
                    {running ? (
                      <Button
                        label="Cancel"
                        size="sm"
                        variant="ghost"
                        icon={<Ban size={14} color={cancelCap.available ? colors.danger : colors['muted-foreground']} />}
                        disabled={!cancelCap.available || cancel.isPending}
                        onPress={() => setConfirmCancel(task)}
                      />
                    ) : null}
                  </View>
                  {running && !cancelCap.available ? (
                    <Text className="text-xs text-muted-foreground">{cancelCap.reason}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </PlainScroll>
      <ConfirmSheet
        visible={confirmCancel !== null}
        onClose={() => setConfirmCancel(null)}
        title={confirmCancel ? `Cancel "${confirmCancel.taskName}"?` : 'Cancel worker?'}
        message="The worker's current turn is aborted. Work it already wrote stays in the workspace."
        confirmLabel="Cancel worker"
        onConfirm={() => {
          if (confirmCancel) {
            haptics.warn();
            cancel.mutate(confirmCancel.taskId);
          }
          setConfirmCancel(null);
        }}
      />
    </>
  );
}

function TaskDigestView({ chatId, taskId, active }: { chatId: string; taskId: string; active: boolean }): React.ReactElement | null {
  const extras = useTaskExtras();
  const digest = useQuery({
    queryKey: [...queryKeys.chatTasks(chatId), taskId, 'digest'],
    queryFn: () => extras.digest(chatId, taskId),
    staleTime: 5_000,
    subscribed: active,
  });

  if (digest.isLoading) return <LoadingState label="Loading digest…" />;
  if (digest.isError) return <Text className="text-xs text-muted-foreground">Digest unavailable.</Text>;
  const d = digest.data;
  if (!d) return null;

  const section = (title: string, items: string[] | undefined, mono = false): React.ReactElement | null =>
    items && items.length > 0 ? (
      <View className="gap-0.5">
        <Text className="text-xs font-semibold text-foreground">{title}</Text>
        {items.map((item, i) => (
          <Text key={i} className={`text-xs text-muted-foreground ${mono ? 'font-mono' : ''}`}>
            • {item}
          </Text>
        ))}
      </View>
    ) : null;

  return (
    <View className="gap-2">
      {d.summary ? (
        <View className="gap-0.5">
          <Text className="text-xs font-semibold text-foreground">Summary</Text>
          <Text className="text-xs leading-relaxed text-muted-foreground">{d.summary}</Text>
        </View>
      ) : null}
      {section('Key findings', d.keyFindings)}
      {section(
        'Artifacts',
        d.artifacts?.map((a) => `${a.path}${a.kind ? ` (${a.kind})` : ''}`),
        true,
      )}
      {section('Risks', d.risks)}
      {section('Open questions', d.openQuestions)}
    </View>
  );
}

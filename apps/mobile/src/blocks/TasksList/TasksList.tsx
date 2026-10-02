// MB-30 TasksList / TaskDetail (MPaneTasks, MPaneTaskDetail; MD-23, MD-25): the Tasks tab of an orchestrator chat — the
// summary card ("4 workers", one segment per worker, the legend), All / Active / Done, and the workers (title, status
// word, model, the review note). A worker opens its detail in the tab's own stack (Back pops it before the pane
// closes): "‹ All tasks · 2 of 4 · ↑ ↓", the status and model, the review round, the worker's report (summary,
// findings, risks, open questions), the files it reported ("See in Changes"), and the footer — Cancel task
// (destructive, confirmed) and Open task chat. The wave, the worker limit and the worker's last steps are not shown
// (MG-36; the digest has no steps).
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import type { BackgroundTaskListItem } from '@generatorai/shared';

import { chatHref } from '../shell/hrefs';
import { usePaneStore } from '../WorkspacePane/paneStore';
import { useBackgroundTasks } from '../WorkspacePane/WorkspacePane.queries';
import { useCapability } from '../../services/auth/useCapability';
import { ListSection } from '../../ui/layout/ListSection';
import { confirm } from '../../ui/native/AlertDialog';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { useBackHandler } from '../../ui/platform/back';
import { haptic } from '../../ui/platform/haptics';
import { useInsets } from '../../ui/platform/insets';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { Link } from '../../ui/primitives/Link';
import { Pressable } from '../../ui/primitives/Pressable';
import { ProgressSegments } from '../../ui/primitives/ProgressSegments';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { useCancelTask, useTaskDigest } from './TasksList.queries';
import { filterTasks, isActiveTask, taskNote, taskStatus, taskSummary, type TaskFilter } from './model/tasksModel';

export interface TasksListProps {
  chatId: string;
  /** The tab is on screen (it polls while a worker runs; Back pops the detail). */
  active: boolean;
}

function TaskRow({ task, onOpen }: { task: BackgroundTaskListItem; onOpen: () => void }): React.ReactElement {
  const status = taskStatus(task.status);
  const note = taskNote(task);
  return (
    <Pressable frame="none" onPress={onOpen} accessibilityRole="button" accessibilityLabel={[task.taskName, status.label ?? status.state, task.model, note].filter(Boolean).join(', ')} className="min-h-row-2 flex-row items-center gap-3 py-3 pe-2 ps-4" testID="task-row">
      <View className="flex-1 gap-1">
        <Text role="transcript" weight={600} numberOfLines={2}>
          {task.taskName}
        </Text>
        <View className="flex-row items-center gap-2">
          {task.model ? (
            <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
              {task.model}
            </Text>
          ) : null}
          <View className="flex-1" />
          <StatusBadge state={status.state} {...(status.label ? { label: status.label } : {})} size="sm" />
        </View>
        {note ? (
          <Text role="footnote" tone="fg-3" numberOfLines={1}>
            {note}
          </Text>
        ) : null}
      </View>
      <Icon concept="chevron-right" size={14} tone="fg-3" />
    </Pressable>
  );
}

function TaskDetail({ chatId, task, index, total, onBack, onStep, active }: { chatId: string; task: BackgroundTaskListItem; index: number; total: number; onBack: () => void; onStep: (delta: -1 | 1) => void; active: boolean }): React.ReactElement {
  const insets = useInsets();
  const digest = useTaskDigest(chatId, task.taskId, active);
  const cancel = useCancelTask(chatId);
  const cancelCap = useCapability('cancelTask');
  const status = taskStatus(task.status);
  const running = isActiveTask(task);
  const files = digest.data?.artifacts ?? [];
  const list = (title: string, items: string[] | undefined): React.ReactNode =>
    items && items.length ? (
      <View className="gap-1">
        <Text role="footnote" weight={600} tone="fg-2">
          {title}
        </Text>
        {items.map((item, i) => (
          <Text key={i} role="footnote">{`• ${item}`}</Text>
        ))}
      </View>
    ) : null;

  return (
    <View className="flex-1" testID="task-detail">
      <View className="min-h-hit flex-row items-center gap-1 pe-2 ps-1">
        <Pressable frame="hit" onPress={onBack} accessibilityRole="button" accessibilityLabel="All tasks" className="flex-row items-center gap-1 px-2">
          <Icon concept="chevron-left" size={16} tone="fg-2" />
          <Text role="subhead" tone="fg-2">
            All tasks
          </Text>
        </Pressable>
        <View className="flex-1" />
        <Text role="monoSm" tone="fg-3">{`${index + 1} of ${total}`}</Text>
        <IconButton icon="chevron-up" size="sm" label="Previous task" disabled={index === 0} onPress={() => onStep(-1)} />
        <IconButton icon="chevron-down" size="sm" label="Next task" disabled={index >= total - 1} onPress={() => onStep(1)} />
      </View>
      <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-4">
        <View className="gap-1.5">
          <Text role="title" accessibilityRole="header">
            {task.taskName}
          </Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <StatusBadge state={status.state} {...(status.label ? { label: status.label } : {})} size="sm" />
            {task.model ? (
              <Text role="monoSm" tone="fg-3">
                {task.model}
              </Text>
            ) : null}
          </View>
        </View>
        {task.reviewRounds > 0 ? (
          <View className="flex-row items-center gap-2 rounded-card bg-raised px-3 py-2">
            <Icon concept="message" size={16} tone="fg-2" />
            <Text role="footnote" weight={600} className="flex-1">
              {task.status === 'completed' ? 'Accepted by the orchestrator' : 'Orchestrator reviewed this work'}
            </Text>
            <Text role="monoSm" tone="fg-3">{`round ${task.reviewRounds}`}</Text>
          </View>
        ) : null}
        {digest.isLoading ? (
          <Skeleton preset="list" count={3} />
        ) : digest.data ? (
          <>
            {digest.data.summary ? (
              <View className="gap-1.5">
                <Text role="footnote" weight={600} tone="fg-2">
                  Report
                </Text>
                <View className="rounded-card border border-line-soft p-3">
                  <Text role="footnote" selectable>
                    {digest.data.summary}
                  </Text>
                </View>
              </View>
            ) : null}
            {list('Key findings', digest.data.keyFindings)}
            {list('Risks', digest.data.risks)}
            {list('Open questions', digest.data.openQuestions)}
            {files.length > 0 ? (
              <View className="gap-1.5">
                <View className="flex-row items-center gap-2">
                  <Text role="footnote" weight={600} tone="fg-2">
                    Files reported
                  </Text>
                  <Text role="monoSm" tone="fg-3">
                    {files.length}
                  </Text>
                  <View className="flex-1" />
                  <Link label="See in Changes" onPress={() => usePaneStore.getState().select('changes')} />
                </View>
                {files.slice(0, 6).map((f) => (
                  <View key={f.path} className="flex-row items-center gap-2">
                    <Icon concept="file" size={14} tone="fg-3" />
                    <Text role="monoSm" tone="fg-2" numberOfLines={1} ellipsizeMode="middle" className="flex-1">
                      {f.path}
                    </Text>
                  </View>
                ))}
                {files.length > 6 ? (
                  <Text role="footnote" tone="fg-3">{`${files.length - 6} more files`}</Text>
                ) : null}
              </View>
            ) : null}
          </>
        ) : (
          <Text role="footnote" tone="fg-3">
            {running ? 'The worker reports when it finishes.' : 'No report from this worker.'}
          </Text>
        )}
      </ScrollView>
      <View className="flex-row gap-2 border-t border-line-soft px-4 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
        {running ? (
          <View className="flex-1">
            <Button
              label="Cancel task"
              icon="x"
              variant="destructive"
              fullWidth
              disabled={!cancelCap.available || cancel.isPending}
              {...(cancelCap.reason ? { disabledReason: cancelCap.reason } : {})}
              onPress={() =>
                void confirm({ title: `Cancel “${task.taskName}”?`, message: "The worker's current turn is stopped. Work it already wrote stays in the workspace.", confirmLabel: 'Cancel task' }).then((yes) => {
                  if (yes) cancel.mutate(task.taskId);
                })
              }
              testID="task-cancel"
            />
          </View>
        ) : null}
        <View className="flex-1">
          <Button label="Open task chat" icon="chats" variant="primary" fullWidth onPress={() => router.push(chatHref(task.taskId) as never)} testID="task-open-chat" />
        </View>
      </View>
    </View>
  );
}

export function TasksList({ chatId, active }: TasksListProps): React.ReactElement {
  const tasks = useBackgroundTasks(chatId, { poll: active });
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useMemo(() => tasks.data?.tasks ?? [], [tasks.data]);
  const shown = filterTasks(list, filter);
  const summary = useMemo(() => taskSummary(list), [list]);
  const openIndex = openId ? shown.findIndex((t) => t.taskId === openId) : -1;
  // The tab's own stack: Back pops the detail before the pane closes (MD-23).
  useBackHandler(active && openId !== null, () => {
    setOpenId(null);
    return true;
  });

  if (tasks.isLoading) {
    return (
      <View className="p-4" accessibilityLabel="Loading tasks">
        <Skeleton preset="list" count={3} />
      </View>
    );
  }
  if (tasks.isError) return <ErrorState title="Couldn't load background tasks" error={tasks.error} onRetry={() => void tasks.refetch()} />;
  if (list.length === 0) return <EmptyState icon="tasks" title="No background tasks yet" description="An orchestrator delegates work to workers; each one it starts appears here." />;

  if (openIndex >= 0) {
    return (
      <TaskDetail
        chatId={chatId}
        task={shown[openIndex]!}
        index={openIndex}
        total={shown.length}
        active={active}
        onBack={() => setOpenId(null)}
        onStep={(delta) => {
          haptic('selection');
          setOpenId(shown[openIndex + delta]?.taskId ?? openId);
        }}
      />
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-3 pb-8 pt-2" testID="tasks">
      <View className="mx-4 gap-2.5 rounded-group bg-raised p-4" accessible accessibilityLabel={`${summary.total} workers, ${summary.active} active, ${summary.done} done`}>
        <View className="flex-row items-baseline gap-2">
          <Text role="headline">{`${summary.total} ${summary.total === 1 ? 'worker' : 'workers'}`}</Text>
          <View className="flex-1" />
          <Text role="monoSm" tone="fg-3">{`${summary.active} active`}</Text>
        </View>
        <ProgressSegments segments={summary.segments} />
        <View className="flex-row flex-wrap gap-x-3 gap-y-1">
          {summary.legend.map((l) => (
            <View key={l.label} className="flex-row items-center gap-1.5">
              <StatusDot state={l.state} size="sm" />
              <Text role="caption" tone="fg-2">{`${l.count} ${l.label.toLowerCase()}`}</Text>
            </View>
          ))}
        </View>
      </View>
      <View className="px-4">
        <SegmentedControl<TaskFilter>
          accessibilityLabel="Show tasks"
          value={filter}
          onValueChange={setFilter}
          segments={[
            { value: 'all', label: 'All', count: summary.total },
            { value: 'active', label: 'Active', count: summary.active },
            { value: 'done', label: 'Done', count: summary.done },
          ]}
          fullWidth
          testID="tasks-filter"
        />
      </View>
      {shown.length === 0 ? (
        <EmptyState icon="tasks" title={filter === 'active' ? 'Nothing running' : 'Nothing finished yet'} compact />
      ) : (
        <ListSection>
          {shown.map((task) => (
            <TaskRow key={task.taskId} task={task} onOpen={() => setOpenId(task.taskId)} />
          ))}
        </ListSection>
      )}
    </ScrollView>
  );
}


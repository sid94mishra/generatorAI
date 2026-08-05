// ────────────────────────────────────────────────────────────────
// Work — runs, workflows and automations.
//
// Three peer catalogues behind one segmented control rather than three tabs:
// HIG caps a tab bar at five destinations, and these three are the same
// activity viewed at different levels (an automation triggers a workflow,
// which produces runs).
//
// Runs are ordered by urgency, not recency — a blocked run is the only thing
// on this screen that costs anything to ignore.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Bot, Clock, Play, Webhook, Workflow as WorkflowIcon } from 'lucide-react-native';
import {
  epochOr,
  queryKeys,
  type AutomationSummary,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { relativeTime, runElapsed, formatDuration } from '../../src/components/runs/formatTime';
import { isActive, needsAttention, statusLabel } from '../../src/components/runs/statusStyle';
import { Badge, Card, StatusDot, type Tone } from '../../src/components/ui/primitives';
import { SegmentedControl, useSegmentSwipe } from '../../src/components/ui/SegmentedControl';
import { Touchable } from '../../src/components/ui/Touchable';
import { SearchField } from '../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { SettingsButton } from '../../src/components/ui/SettingsButton';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { useTheme } from '../../src/theme/ThemeProvider';

type Tab = 'runs' | 'workflows' | 'automations';

type Row =
  | { kind: 'run'; item: WorkflowRunSummary }
  | { kind: 'workflow'; item: WorkflowSummary }
  | { kind: 'automation'; item: AutomationSummary };

const TABS = [
  { value: 'runs' as const, label: 'Runs' },
  { value: 'workflows' as const, label: 'Workflows' },
  { value: 'automations' as const, label: 'Automations' },
];

function runTone(status: string): Tone {
  if (needsAttention(status)) return status === 'failed' ? 'danger' : 'warning';
  if (isActive(status)) return 'info';
  if (status === 'completed') return 'success';
  return 'neutral';
}

export default function WorkScreen(): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const [tab, setTab] = useState<Tab>('runs');
  const [query, setQuery] = useState('');
  const listRef = useRef<never>(null);

  useScrollToTop('runs', scrollerToTop(listRef));

  const runs = useQuery({
    queryKey: queryKeys.runs(),
    queryFn: () => api.runs.list(),
    // Only polls while something is moving; a settled list would otherwise
    // wake the radio every fifteen seconds for nothing.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r: WorkflowRunSummary) => isActive(r.status)) ? 10_000 : false,
  });

  const workflows = useQuery({
    queryKey: queryKeys.workflows(),
    queryFn: () => api.workflows.list(),
  });

  const automations = useQuery({
    queryKey: queryKeys.automations(),
    queryFn: () => api.automations.list(),
  });

  const orderedRuns = useMemo(
    () =>
      [...(runs.data ?? [])].sort((a, b) => {
        const aBlocked = needsAttention(a.status);
        const bBlocked = needsAttention(b.status);
        if (aBlocked !== bBlocked) return aBlocked ? -1 : 1;
        const aActive = isActive(a.status);
        const bActive = isActive(b.status);
        if (aActive !== bActive) return aActive ? -1 : 1;
        return epochOr(b.updatedAt) - epochOr(a.updatedAt);
      }),
    [runs.data],
  );

  const active = tab === 'runs' ? runs : tab === 'workflows' ? workflows : automations;

  const segments = useMemo(
    () => [
      { ...TABS[0]!, count: orderedRuns.length },
      { ...TABS[1]!, count: workflows.data?.length ?? 0 },
      { ...TABS[2]!, count: automations.data?.length ?? 0 },
    ],
    [orderedRuns.length, workflows.data?.length, automations.data?.length],
  );

  const swipeTab = useSegmentSwipe(segments, tab, setTab);
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .failOffsetY([-16, 16])
        .onEnd((event) => {
          if (Math.abs(event.translationX) < 48) return;
          swipeTab(event.translationX);
        })
        .runOnJS(true),
    [swipeTab],
  );

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (name: string | null | undefined) =>
      !q || (name ?? '').toLowerCase().includes(q);

    if (tab === 'runs') {
      return orderedRuns.filter((r) => matches(r.name)).map((item) => ({ kind: 'run', item }));
    }
    if (tab === 'workflows') {
      return (workflows.data ?? [])
        .filter((w) => matches(w.name))
        .map((item) => ({ kind: 'workflow', item }));
    }
    return (automations.data ?? [])
      .filter((a) => matches(a.name))
      .map((item) => ({ kind: 'automation', item }));
  }, [tab, query, orderedRuns, workflows.data, automations.data]);

  const refreshAll = () => {
    void runs.refetch();
    void workflows.refetch();
    void automations.refetch();
  };

  const header = (
    <View className="gap-3 pb-3">
      <SegmentedControl segments={segments} value={tab} onChange={setTab} />
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={
          tab === 'runs'
            ? 'Search runs'
            : tab === 'workflows'
              ? 'Search workflows'
              : 'Search automations'
        }
      />
    </View>
  );

  const empty = active.isLoading ? (
    <SkeletonList rows={5} />
  ) : active.isError ? (
    <ErrorState message="Could not load this list." onRetry={() => void active.refetch()} />
  ) : query ? (
    <EmptyState title="No matches" message="Nothing here matches that search." />
  ) : tab === 'runs' ? (
    <EmptyState
      title="No runs yet"
      message="Runs appear when a workflow or automation executes."
      icon={<Play size={22} color={colors['muted-foreground']} />}
    />
  ) : tab === 'workflows' ? (
    <EmptyState
      title="No workflows"
      message="Workflows are authored on the desktop or web app — a node graph needs more room than a phone has."
      icon={<WorkflowIcon size={22} color={colors['muted-foreground']} />}
    />
  ) : (
    <EmptyState
      title="No automations"
      message="Automations are created on the desktop or web app. Their runs and history show up here."
      icon={<Bot size={22} color={colors['muted-foreground']} />}
    />
  );

  return (
    <Screen title="Work" trailing={<SettingsButton />} scroll={false}>
      <GestureDetector gesture={swipe}>
        <View className="flex-1">
          <LegendList
            ref={listRef as never}
            data={rows}
            keyExtractor={(row: Row) => `${row.kind}:${row.item.id}`}
            estimatedItemSize={108}
            recycleItems
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 10 }}
            ListHeaderComponent={header}
            ListEmptyComponent={empty}
            refreshing={runs.isFetching || workflows.isFetching || automations.isFetching}
            onRefresh={refreshAll}
            renderItem={({ item: row }: { item: Row }) =>
              row.kind === 'run' ? (
                <RunCard run={row.item} />
              ) : row.kind === 'workflow' ? (
                <WorkflowCard workflow={row.item} runs={runs.data ?? []} />
              ) : (
                <AutomationCard automation={row.item} />
              )
            }
          />
        </View>
      </GestureDetector>
    </Screen>
  );
}

function RunCard({ run }: { run: WorkflowRunSummary }): React.ReactElement {
  const tone = runTone(run.status);
  const elapsed = runElapsed(run, isActive(run.status) ? null : run.updatedAt);

  return (
    <Touchable
      accessibilityLabel={`${run.name ?? 'Run'}, ${statusLabel(run.status)}`}
      haptic="tap"
      scale="large"
      onPress={() => router.push(`/runs/${run.id}`)}
    >
      <Card className={`gap-2 p-3.5 ${needsAttention(run.status) ? 'border-warning' : ''}`}>
        <View className="flex-row items-center gap-2">
          <StatusDot tone={tone} label={null} />
          <Text numberOfLines={1} className="flex-1 text-md font-medium text-foreground">
            {run.name ?? 'Workflow run'}
          </Text>
          <Badge label={statusLabel(run.status)} tone={tone} />
        </View>
        <Text numberOfLines={1} className="text-xs text-muted-foreground">
          {relativeTime(run.updatedAt)}
          {elapsed !== null ? ` · ran ${formatDuration(elapsed)}` : ''}
        </Text>
        {run.error ? (
          <Text numberOfLines={2} className="text-xs text-danger">
            {run.error}
          </Text>
        ) : null}
      </Card>
    </Touchable>
  );
}

function WorkflowCard({
  workflow,
  runs,
}: {
  workflow: WorkflowSummary;
  runs: WorkflowRunSummary[];
}): React.ReactElement {
  const { colors } = useTheme();
  const mine = runs.filter((r) => r.workflowDefinitionId === workflow.id);
  const latest = mine[0];

  return (
    <Touchable
      accessibilityLabel={workflow.name}
      haptic="tap"
      scale="large"
      onPress={() => router.push(`/workflows/${workflow.id}`)}
    >
      <Card className="flex-row items-center gap-3 p-3.5">
        <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
          <WorkflowIcon size={16} color={colors['muted-foreground']} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-md font-medium text-foreground">
            {workflow.name}
          </Text>
          <Text numberOfLines={1} className="text-xs text-muted-foreground">
            {mine.length} run{mine.length === 1 ? '' : 's'}
            {latest ? ` · last ${relativeTime(latest.updatedAt)}` : ''}
          </Text>
        </View>
        {latest ? (
          <StatusDot tone={runTone(latest.status)} label={`Last run ${statusLabel(latest.status)}`} />
        ) : null}
      </Card>
    </Touchable>
  );
}

function AutomationCard({ automation }: { automation: AutomationSummary }): React.ReactElement {
  const { colors } = useTheme();
  const TriggerIcon =
    automation.triggerType === 'schedule' ? Clock : automation.triggerType === 'webhook' ? Webhook : Play;

  return (
    <Touchable
      accessibilityLabel={automation.name}
      haptic="tap"
      scale="large"
      onPress={() => router.push(`/automations/${automation.id}`)}
    >
      <Card className="flex-row items-center gap-3 p-3.5">
        <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
          <TriggerIcon size={16} color={colors['muted-foreground']} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-md font-medium text-foreground">
            {automation.name}
          </Text>
          <Text numberOfLines={1} className="text-xs text-muted-foreground">
            {automation.triggerType}
            {automation.lastRunAt ? ` · last ran ${relativeTime(automation.lastRunAt)}` : ' · never run'}
          </Text>
        </View>
        <Badge
          label={automation.enabled ? 'On' : 'Off'}
          tone={automation.enabled ? 'success' : 'neutral'}
        />
      </Card>
    </Touchable>
  );
}

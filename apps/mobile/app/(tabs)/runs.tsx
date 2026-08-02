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

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
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
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Touchable } from '../../src/components/ui/Touchable';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { SettingsButton } from '../../src/components/ui/SettingsButton';
import { useTheme } from '../../src/theme/ThemeProvider';

type Tab = 'runs' | 'workflows' | 'automations';

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

  return (
    <Screen
      title="Work"
      trailing={<SettingsButton />}
      onRefresh={() => {
        void runs.refetch();
        void workflows.refetch();
        void automations.refetch();
      }}
      refreshing={runs.isFetching || workflows.isFetching || automations.isFetching}
    >
      <SegmentedControl
        segments={[
          { value: 'runs', label: 'Runs', count: orderedRuns.length },
          { value: 'workflows', label: 'Workflows', count: workflows.data?.length ?? 0 },
          { value: 'automations', label: 'Automations', count: automations.data?.length ?? 0 },
        ]}
        value={tab}
        onChange={setTab}
      />

      {active.isLoading ? (
        <SkeletonList rows={5} />
      ) : active.isError ? (
        <ErrorState message="Could not load this list." onRetry={() => void active.refetch()} />
      ) : tab === 'runs' ? (
        orderedRuns.length === 0 ? (
          <EmptyState
            title="No runs yet"
            message="Runs appear when a workflow or automation executes."
            icon={<Play size={22} color={colors['muted-foreground']} />}
          />
        ) : (
          <View className="gap-2.5">
            {orderedRuns.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </View>
        )
      ) : tab === 'workflows' ? (
        (workflows.data ?? []).length === 0 ? (
          <EmptyState
            title="No workflows"
            message="Workflows are authored on the desktop or web app — a node graph needs more room than a phone has."
            icon={<WorkflowIcon size={22} color={colors['muted-foreground']} />}
          />
        ) : (
          <View className="gap-2.5">
            {(workflows.data ?? []).map((workflow) => (
              <WorkflowCard key={workflow.id} workflow={workflow} runs={runs.data ?? []} />
            ))}
          </View>
        )
      ) : (automations.data ?? []).length === 0 ? (
        <EmptyState
          title="No automations"
          message="Automations are created on the desktop or web app. Their runs and history show up here."
          icon={<Bot size={22} color={colors['muted-foreground']} />}
        />
      ) : (
        <View className="gap-2.5">
          {(automations.data ?? []).map((automation) => (
            <AutomationCard key={automation.id} automation={automation} />
          ))}
        </View>
      )}
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
          <StatusDot tone={tone} />
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
        {latest ? <StatusDot tone={runTone(latest.status)} /> : null}
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

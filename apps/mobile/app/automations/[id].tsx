// ────────────────────────────────────────────────────────────────
// Automation detail.
//
// Creation and editing stay on the desktop — the trigger, input mode and
// retry configuration is a multi-step form nobody wants on a phone. What
// belongs here is the part you check while away: is it on, when did it last
// run, and did the last run succeed.
//
// Executions poll only while one is in flight.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Clock, Info, Play, Webhook, Workflow } from 'lucide-react-native';
import { queryKeys, type AutomationExecutionSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature } from '../../src/auth/featureGate';
import { formatDuration, relativeTime, runElapsed } from '../../src/components/runs/formatTime';
import { isActive, statusLabel } from '../../src/components/runs/statusStyle';
import { Badge, Card, SectionHeader, StatusDot, type Tone } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { PlainScroll } from '../../src/components/ui/Screen';
import { EmptyState, ErrorState, Spinner } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { useTheme } from '../../src/theme/ThemeProvider';

function toneOf(status: string): Tone {
  if (status === 'completed' || status === 'succeeded') return 'success';
  if (status === 'failed') return 'danger';
  if (isActive(status)) return 'info';
  return 'neutral';
}

export default function AutomationDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const navigation = useNavigation();
  const { state } = useAuth();
  const { colors } = useTheme();

  const runControl = checkFeature(
    'runControl',
    state.status === 'authenticated' ? state.scopes : [],
  );

  const automation = useQuery({
    queryKey: queryKeys.automation(id!),
    queryFn: () => api.automations.get(id!),
  });

  const executions = useQuery({
    queryKey: queryKeys.automationExecutions(id!),
    queryFn: () => api.automations.executions(id!),
    refetchInterval: (query) => {
      const list = (query.state.data ?? []) as AutomationExecutionSummary[];
      return list.some((e) => isActive(e.status)) ? 5_000 : false;
    },
  });

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: automation.data?.name ?? 'Automation' });
  }, [navigation, automation.data?.name]);

  if (automation.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={4} />
      </View>
    );
  }
  if (automation.isError) {
    return (
      <ErrorState message="Could not load this automation." onRetry={() => void automation.refetch()} />
    );
  }

  const data = automation.data!;
  const TriggerIcon =
    data.triggerType === 'schedule' ? Clock : data.triggerType === 'webhook' ? Webhook : Play;

  return (
    <PlainScroll
      onRefresh={() => {
        void automation.refetch();
        void executions.refetch();
      }}
      refreshing={automation.isFetching || executions.isFetching}
    >
      <Card className="gap-2.5 p-4">
        <View className="flex-row items-center gap-2.5">
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-subtle">
            <TriggerIcon size={18} color={colors['muted-foreground']} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-lg font-semibold text-foreground">{data.name}</Text>
            <Text className="text-xs text-muted-foreground">
              Triggered {data.triggerType}
              {data.lastRunAt ? ` · last ran ${relativeTime(data.lastRunAt)}` : ' · never run'}
            </Text>
          </View>
          <Badge label={data.enabled ? 'On' : 'Off'} tone={data.enabled ? 'success' : 'neutral'} />
        </View>
        {data.description ? (
          <Text className="text-sm leading-relaxed text-muted-foreground">{data.description}</Text>
        ) : null}
      </Card>

      <SectionHeader title="Runs" />
      <ListGroup>
        <ListRow
          title="Workflow"
          subtitle="Open the definition this automation runs"
          icon={<Workflow size={18} color={colors.primary} />}
          onPress={() => router.push(`/workflows/${data.workflowDefinitionId}`)}
        />
      </ListGroup>

      <SectionHeader title={`History (${executions.data?.length ?? 0})`} />
      {executions.isLoading ? (
        <SkeletonList rows={3} />
      ) : (executions.data ?? []).length === 0 ? (
        <EmptyState title="Never executed" message="Executions appear here once it runs." />
      ) : (
        <View className="gap-2">
          {(executions.data ?? []).map((execution) => (
            <Card key={execution.id} className="gap-1.5 p-3.5">
              <View className="flex-row items-center gap-2">
                <StatusDot tone={toneOf(execution.status)} />
                <Text className="flex-1 text-sm text-foreground">
                  {relativeTime(execution.startedAt ?? null)}
                </Text>
                {isActive(execution.status) ? <Spinner /> : null}
                <Badge label={statusLabel(execution.status)} tone={toneOf(execution.status)} />
              </View>
              <Text className="text-xs text-muted-foreground">
                {execution.completedRuns ?? 0}/{execution.totalRuns ?? 0} runs
                {execution.failedRuns ? ` · ${execution.failedRuns} failed` : ''}
                {/* `runElapsed` parses the ISO timestamps the server sends;
                    subtracting the raw fields would be NaN. */}
                {execution.completedAt ? ` · ${formatDuration(runElapsed(execution) ?? 0)}` : ''}
              </Text>
            </Card>
          ))}
        </View>
      )}

      <View className="mt-2 flex-row gap-2.5 rounded-3xl border border-border bg-subtle p-3.5">
        <Info size={16} color={colors['muted-foreground']} />
        <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">
          Creating, editing and manually triggering automations happens on the desktop or web app.
          {' '}
          {runControl.reason}
        </Text>
      </View>
    </PlainScroll>
  );
}

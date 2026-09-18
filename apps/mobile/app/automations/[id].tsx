// ────────────────────────────────────────────────────────────────
// Automation detail.
//
// Creation and editing stay on the desktop — the trigger, input mode and
// retry configuration is a multi-step form nobody wants on a phone. What
// belongs here is the part you act on while away: is it on, run it now
// (with a dataset, for a schema-driven automation — TriggerInputSheet),
// when does it fire next, did the last execution succeed, and deleting it.
//
// History comes from the executions `GET /api/automations/:id` already
// carries (no duplicate fetch); the query polls only while one is in flight.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Lock, MoreHorizontal, Trash2 } from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Play, Webhook, Workflow } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { useAdminApi } from '../../src/api/useAdminApi';
import { useApi } from '../../src/api/useApi';
import { sectionRows } from '../../src/components/common/groupByDay';
import { relativeTime } from '../../src/components/runs/formatTime';
import { useFeature } from '../../src/components/runs/useFeature';
import { usePullRefresh } from '../../src/components/runs/usePullRefresh';
import { ExecutionSheet } from '../../src/components/work/ExecutionSheet';
import { TriggerInputSheet } from '../../src/components/work/TriggerInputSheet';
import { ActionSheet, ConfirmSheet } from '../../src/components/ui/ActionSheet';
import { IconButton } from '../../src/components/ui/Button';
import {
  executionCounts,
  executionIdOf,
  executionPollInterval,
  executionStatusLabel,
  executionTime,
  executionTone,
  isExecutionActive,
  makeIdempotencyKey,
  nextRunLabel,
  sortExecutions,
  triggerDescription,
  triggeredByLabel,
  workflowIdsOf,
  type AutomationView,
  type ExecutionView,
} from '../../src/components/work/automationModel';
import { Button } from '../../src/components/ui/Button';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { Card, SectionHeader, StatusDot } from '../../src/components/ui/primitives';
import { PlainScroll } from '../../src/components/ui/Screen';
import { SkeletonCard, SkeletonList } from '../../src/components/ui/Skeleton';
import { EmptyState, ErrorState, Spinner } from '../../src/components/ui/States';
import { haptics } from '../../src/components/ui/haptics';
import { useTheme } from '../../src/theme/ThemeProvider';

/** History is a glance, not an audit log — the desktop has the full list. */
const HISTORY_LIMIT = 50;

export default function AutomationDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const automationId = id ?? '';
  const admin = useAdminApi();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const runControl = useFeature('runControl');

  const [openExecId, setOpenExecId] = useState<string | null>(null);
  const [inputSheet, setInputSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const automation = useQuery({
    queryKey: queryKeys.automation(automationId),
    queryFn: async () => (await admin.automations.get(automationId)) as unknown as AutomationView,
    enabled: automationId.length > 0,
    refetchInterval: (query) => executionPollInterval(query.state.data?.executions),
  });

  // Only when the detail payload did not carry executions (older servers).
  const embedded = Array.isArray(automation.data?.executions);
  const executionsFallback = useQuery({
    queryKey: queryKeys.automationExecutions(automationId),
    queryFn: async () =>
      (await admin.automations.executions(automationId)) as unknown as ExecutionView[],
    enabled: automation.isSuccess && !embedded,
    refetchInterval: (query) => executionPollInterval(query.state.data),
  });

  const workflows = useQuery({
    queryKey: queryKeys.workflows(),
    queryFn: () => api.workflows.list(),
    enabled: automation.isSuccess,
    staleTime: 60_000,
  });

  const workflowNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const w of workflows.data ?? []) map[w.id] = w.name;
    return map;
  }, [workflows.data]);

  const executions = useMemo(() => {
    const list = embedded ? automation.data?.executions ?? [] : executionsFallback.data ?? [];
    return sortExecutions(list).slice(0, HISTORY_LIMIT);
  }, [embedded, automation.data?.executions, executionsFallback.data]);

  const { refreshing, onRefresh } = usePullRefresh(() =>
    Promise.all([
      automation.refetch(),
      embedded ? undefined : executionsFallback.refetch(),
    ]),
  );

  const hasData = Boolean(automation.data);
  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: automation.data?.name ?? 'Automation',
      headerRight: () =>
        hasData ? (
          <IconButton
            icon={<MoreHorizontal size={20} color={colors.foreground} />}
            accessibilityLabel="Automation actions"
            onPress={() => setMenu(true)}
          />
        ) : null,
    });
  }, [navigation, automation.data?.name, hasData, colors.foreground]);

  // ── Delete ──────────────────────────────────────────────────
  const remove = useMutation({
    mutationFn: () => admin.automations.remove(automationId),
    onSuccess: () => {
      haptics.commit();
      queryClient.removeQueries({ queryKey: queryKeys.automation(automationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.automations() });
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/runs');
    },
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not delete', err instanceof Error ? err.message : String(err));
    },
  });

  // ── On / off — optimistic ───────────────────────────────────
  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      next ? admin.automations.enable(automationId) : admin.automations.disable(automationId),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.automation(automationId), exact: true });
      const previous = queryClient.getQueryData<AutomationView>(queryKeys.automation(automationId));
      if (previous) {
        queryClient.setQueryData<AutomationView>(queryKeys.automation(automationId), {
          ...previous,
          enabled: next,
        });
      }
      return { previous };
    },
    onError: (err, next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.automation(automationId), context.previous);
      }
      haptics.error();
      Alert.alert(
        next ? 'Could not turn on' : 'Could not turn off',
        err instanceof Error ? err.message : String(err),
      );
    },
    onSuccess: (updated) => {
      // Merge rather than replace: the enable/disable response carries no
      // executions, and replacing would blank the history until the refetch.
      const u = updated as unknown as Partial<AutomationView>;
      queryClient.setQueryData<AutomationView>(queryKeys.automation(automationId), (prev) =>
        prev ? { ...prev, enabled: u.enabled ?? prev.enabled, nextRunAt: u.nextRunAt ?? null } : prev,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.automations() });
    },
  });

  // ── Run now ─────────────────────────────────────────────────
  const trigger = useMutation({
    mutationFn: (key: string) =>
      admin.automations.trigger(automationId, undefined, { idempotencyKey: key }),
    onSuccess: (response) => {
      haptics.success();
      const execId = executionIdOf(response);
      if (execId) setOpenExecId(execId);
    },
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not run', err instanceof Error ? err.message : String(err));
    },
    onSettled: () => {
      idempotencyKey.current = null;
      // Prefix match also refreshes the executions and execution keys.
      void queryClient.invalidateQueries({ queryKey: queryKeys.automation(automationId) });
    },
  });

  const runNow = () => {
    // A schema-driven automation takes its dataset in the sheet.
    if (automation.data?.dataSchema) {
      haptics.tap();
      setInputSheet(true);
      return;
    }
    // One key per tap intent: a second tap before the first settles replays
    // the same request instead of starting a second execution.
    idempotencyKey.current ??= makeIdempotencyKey(automationId);
    haptics.commit();
    trigger.mutate(idempotencyKey.current);
  };

  // ── States ──────────────────────────────────────────────────
  if (automation.isLoading || !automationId) {
    return (
      <View className="gap-3 p-4">
        <SkeletonCard height={112} />
        <SkeletonList rows={2} />
        <SkeletonList rows={3} />
      </View>
    );
  }
  if (automation.isError || !automation.data) {
    return (
      <View className="flex-1 p-4">
        <ErrorState message="Could not load this automation." onRetry={() => void automation.refetch()} />
      </View>
    );
  }

  const data = automation.data;
  const TriggerIcon =
    data.triggerType === 'schedule' ? Clock : data.triggerType === 'webhook' ? Webhook : Play;
  const nextRun = data.enabled && data.triggerType === 'schedule' ? nextRunLabel(data.nextRunAt) : null;
  const takesInputs = Boolean(data.dataSchema);
  const workflowIds = workflowIdsOf(data);
  const openSummary = executions.find((e) => e.id === openExecId) ?? null;

  const runHint = !runControl.available
    ? null
    : !data.enabled
      ? 'Turn the automation on to run it'
      : takesInputs
        ? 'Choose the dataset to run with'
        : null;

  const sections = sectionRows(executions, {
    keyOf: (e) => e.id,
    timeOf: (e) => executionTime(e),
    pinned: { label: 'Running', key: 'running', test: (e) => isExecutionActive(e.status) },
  });
  const groups: { key: string; label: string; items: ExecutionView[] }[] = [];
  for (const row of sections) {
    if (row.type === 'header') groups.push({ key: row.key, label: row.label, items: [] });
    else groups[groups.length - 1]?.items.push(row.item);
  }

  return (
    <>
      <PlainScroll onRefresh={onRefresh} refreshing={refreshing}>
        <Card className="gap-2.5 p-4">
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-2xl bg-emphasis">
              <TriggerIcon size={18} color={colors['muted-foreground']} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="text-lg font-semibold text-foreground" numberOfLines={2}>
                {data.name}
              </Text>
              <Text className="text-sm text-muted-foreground" numberOfLines={2}>
                {triggerDescription(data)}
              </Text>
            </View>
          </View>
          {data.description ? (
            <Text className="text-sm leading-relaxed text-muted-foreground">{data.description}</Text>
          ) : null}
          <Text className="text-sm text-muted-foreground">
            {[nextRun, data.lastRunAt ? `Last ran ${relativeTime(data.lastRunAt)}` : 'Never run']
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Card>

        <ListGroup>
          <ListRow
            title={data.enabled ? 'On' : 'Off'}
            subtitle={
              data.enabled
                ? data.triggerType === 'manual'
                  ? 'Can be run'
                  : 'Fires automatically'
                : 'Paused — nothing runs'
            }
            toggle={{
              value: data.enabled,
              onValueChange: (next) => toggle.mutate(next),
            }}
            disabled={!runControl.available || toggle.isPending}
            accessibilityLabel="Automation enabled"
            accessibilityHint={data.enabled ? 'Turns the automation off' : 'Turns the automation on'}
          />
        </ListGroup>

        <View className="gap-2">
          <Button
            label={takesInputs ? 'Run with inputs…' : 'Run now'}
            variant="primary"
            size="lg"
            full
            icon={<Play size={18} color={colors['primary-foreground']} />}
            loading={trigger.isPending}
            disabled={!runControl.available || !data.enabled || trigger.isPending}
            haptic="none"
            accessibilityLabel="Run now"
            {...(runHint ? { accessibilityHint: runHint } : {})}
            onPress={runNow}
          />
          {runHint && !takesInputs ? (
            <Text className="text-center text-sm text-muted-foreground">{runHint}</Text>
          ) : null}
          {!runControl.available ? (
            <View className="flex-row items-center gap-2">
              {runControl.reason ? (
                <Text className="flex-1 text-sm text-muted-foreground">{runControl.reason}</Text>
              ) : (
                <View className="flex-1" />
              )}
              <Button
                label="Request access"
                variant="ghost"
                size="sm"
                accessibilityLabel="Request access to control automations"
                onPress={runControl.requestAccess}
              />
            </View>
          ) : null}
        </View>

        {workflowIds.length > 0 ? (
          <View>
            <SectionHeader title={workflowIds.length > 1 ? `Workflows (${workflowIds.length})` : 'Workflow'} />
            <ListGroup>
              {workflowIds.map((wid, index) => (
                <ListRow
                  key={`${wid}:${index}`}
                  title={workflowNames[wid] ?? (workflows.isLoading ? 'Loading…' : 'Workflow')}
                  subtitle={workflowIds.length > 1 ? `Step ${index + 1}` : null}
                  icon={<Workflow size={18} color={colors['muted-foreground']} />}
                  accessibilityHint="Opens the workflow"
                  onPress={() => router.push(`/workflows/${wid}`)}
                />
              ))}
            </ListGroup>
          </View>
        ) : null}

        <View>
          <SectionHeader title="History" />
          {!embedded && executionsFallback.isLoading ? (
            <SkeletonList rows={3} />
          ) : !embedded && executionsFallback.isError ? (
            <ErrorState
              message="Could not load history."
              onRetry={() => void executionsFallback.refetch()}
            />
          ) : executions.length === 0 ? (
            <EmptyState
              compact
              icon={<Clock size={22} color={colors['muted-foreground']} />}
              title="No executions yet"
            />
          ) : (
            <View className="gap-1">
              {groups.map((group, gi) => (
                <View key={group.key}>
                  <Text
                    accessibilityRole="header"
                    className={`pb-2 text-sm text-muted-foreground ${gi > 0 ? 'pt-3' : ''}`}
                  >
                    {group.label}
                  </Text>
                  <ListGroup>
                    {group.items.map((execution) => {
                      const active = isExecutionActive(execution.status);
                      const status = executionStatusLabel(execution.status);
                      const subtitle = [
                        triggeredByLabel(execution.triggeredBy),
                        relativeTime(execution.startedAt ?? execution.createdAt ?? null),
                        executionCounts(execution),
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <ListRow
                          key={execution.id}
                          title={status}
                          subtitle={subtitle}
                          trailing={
                            active ? (
                              <Spinner label="In progress" />
                            ) : (
                              <StatusDot tone={executionTone(execution.status)} label={null} />
                            )
                          }
                          accessibilityLabel={`Execution ${status}, ${subtitle}`}
                          accessibilityHint="Shows execution details"
                          onPress={() => setOpenExecId(execution.id)}
                        />
                      );
                    })}
                  </ListGroup>
                </View>
              ))}
            </View>
          )}
        </View>
      </PlainScroll>

      <ExecutionSheet
        automationId={automationId}
        executionId={openExecId}
        summary={openSummary}
        workflowNames={workflowNames}
        onClose={() => setOpenExecId(null)}
      />

      <TriggerInputSheet
        visible={inputSheet}
        onClose={() => setInputSheet(false)}
        automation={data}
        onTriggered={(execId) => {
          // Let the input sheet dismiss before the execution sheet presents.
          if (execId) setTimeout(() => setOpenExecId(execId), 250);
        }}
      />

      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={data.name}
        actions={
          runControl.available
            ? [
                {
                  label: 'Delete automation',
                  destructive: true,
                  icon: <Trash2 size={18} color={colors.danger} />,
                  onPress: () => {
                    haptics.warn();
                    setConfirmDelete(true);
                  },
                },
              ]
            : [
                {
                  label: 'Request access',
                  detail: 'Deleting automations needs workflow permission on this device.',
                  icon: <Lock size={18} color={colors['muted-foreground']} />,
                  onPress: runControl.requestAccess,
                },
              ]
        }
      />
      <ConfirmSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this automation?"
        message="It stops firing and any execution still in progress is cancelled. Workflows and completed runs are kept."
        confirmLabel="Delete automation"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

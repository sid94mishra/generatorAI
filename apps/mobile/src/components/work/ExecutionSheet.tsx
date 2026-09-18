// ────────────────────────────────────────────────────────────────
// ExecutionSheet — one automation execution: what fired it, how far it got,
// and the workflow runs it spawned (each opens the run screen).
//
// Polls while the execution is still pending/running. Cancelling is
// destructive, so it goes through a confirmation, and like every run control
// it is shown disabled with "Request access" when the device lacks the scope.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { useAdminApi } from '../../api/useAdminApi';
import { formatDuration, relativeTime, runElapsed } from '../runs/formatTime';
import { useFeature } from '../runs/useFeature';
import { ConfirmSheet } from '../ui/ActionSheet';
import { Button } from '../ui/Button';
import { ListGroup, ListRow } from '../ui/ListRow';
import { Badge, SectionHeader, StatusDot } from '../ui/primitives';
import { Sheet } from '../ui/Sheet';
import { SkeletonList } from '../ui/Skeleton';
import { ErrorState, Spinner } from '../ui/States';
import { haptics } from '../ui/haptics';
import {
  executionCounts,
  executionPollInterval,
  executionStatusLabel,
  executionTone,
  isExecutionActive,
  triggeredByLabel,
  type ExecutionRunView,
  type ExecutionView,
} from './automationModel';

type ExecutionDetail = ExecutionView & { runs?: ExecutionRunView[] };

export function ExecutionSheet({
  automationId,
  executionId,
  summary,
  workflowNames,
  onClose,
}: {
  automationId: string;
  /** null = closed. */
  executionId: string | null;
  /** The history row, so the header renders before the detail loads. */
  summary?: ExecutionView | null;
  /** workflowDefinitionId → name, when the caller already resolved them. */
  workflowNames?: Record<string, string>;
  onClose: () => void;
}): React.ReactElement | null {
  const admin = useAdminApi();
  const queryClient = useQueryClient();
  const runControl = useFeature('runControl');
  const [confirming, setConfirming] = useState(false);

  const detail = useQuery({
    queryKey: queryKeys.automationExecution(automationId, executionId ?? '-'),
    queryFn: async () =>
      (await admin.automations.execution(automationId, executionId!)) as unknown as ExecutionDetail,
    enabled: executionId !== null,
    refetchInterval: (query) => executionPollInterval(query.state.data ? [query.state.data] : []),
  });

  const cancel = useMutation({
    mutationFn: () => admin.automations.cancelExecution(automationId, executionId!),
    onSuccess: () => {
      haptics.success();
    },
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not cancel', err instanceof Error ? err.message : String(err));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.automation(automationId) });
    },
  });

  if (executionId === null) return null;

  const execution: ExecutionView | undefined =
    detail.data ?? (summary && summary.id === executionId ? summary : undefined);
  const active = execution ? isExecutionActive(execution.status) : false;
  const counts = execution ? executionCounts(execution) : null;
  const elapsed = execution ? runElapsed(execution) : null;
  const runs = detail.data?.runs ?? [];

  const openRun = (runId: string) => {
    onClose();
    // Let the sheet's modal dismiss before the stack pushes, or iOS drops
    // the push while a modal is still presented.
    setTimeout(() => router.push(`/runs/${runId}`), 250);
  };

  return (
    <>
      <Sheet
        visible
        onClose={onClose}
        title="Execution"
        detents={[0.6, 0.92]}
        keyboardAware={false}
      >
        <View className="gap-3 px-4 pb-6">
          {execution ? (
            <View className="gap-2">
              <View className="flex-row items-center gap-2">
                <Badge label={executionStatusLabel(execution.status)} tone={executionTone(execution.status)} />
                {active ? <Spinner label="Execution in progress" /> : null}
              </View>
              <Text className="text-sm text-muted-foreground">
                {triggeredByLabel(execution.triggeredBy)} trigger
                {' · started '}
                {relativeTime(execution.startedAt ?? execution.createdAt ?? null)}
                {elapsed !== null ? ` · ${active ? 'running for' : 'took'} ${formatDuration(elapsed)}` : ''}
              </Text>
              {counts ? <Text className="text-sm text-muted-foreground">{counts}</Text> : null}
              {execution.error ? (
                <Text selectable className="text-sm text-danger">
                  {execution.error}
                </Text>
              ) : null}
            </View>
          ) : null}

          {active ? (
            <View className="gap-2">
              <Button
                label="Cancel execution"
                variant="danger"
                full
                disabled={!runControl.available || cancel.isPending}
                loading={cancel.isPending}
                accessibilityLabel="Cancel execution"
                onPress={() => {
                  haptics.warn();
                  setConfirming(true);
                }}
              />
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
                    accessibilityLabel="Request access to control runs"
                    onPress={runControl.requestAccess}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          <SectionHeader title={runs.length ? `Runs (${runs.length})` : 'Runs'} />
          {detail.isLoading ? (
            <SkeletonList rows={2} />
          ) : detail.isError ? (
            <ErrorState message="Could not load this execution." onRetry={() => void detail.refetch()} />
          ) : runs.length === 0 ? (
            <Text className="text-sm text-muted-foreground">
              {active ? 'Runs appear here as they start.' : 'This execution started no workflow runs.'}
            </Text>
          ) : (
            <ListGroup>
              {runs.map((run) => {
                const name = workflowNames?.[run.workflowDefinitionId] ?? 'Workflow run';
                const parts = [
                  run.iterationLabel || null,
                  executionStatusLabel(run.status),
                  run.attemptCount && run.attemptCount > 1 ? `attempt ${run.attemptCount}` : null,
                ].filter(Boolean);
                return (
                  <ListRow
                    key={run.id ?? `${run.workflowRunId}:${run.iterationIndex ?? 0}`}
                    title={name}
                    subtitle={parts.join(' · ')}
                    trailing={<StatusDot tone={executionTone(run.status)} label={null} />}
                    accessibilityLabel={`${name}, ${parts.join(', ')}`}
                    accessibilityHint="Opens the workflow run"
                    onPress={() => openRun(run.workflowRunId)}
                  />
                );
              })}
            </ListGroup>
          )}
        </View>
      </Sheet>

      <ConfirmSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title="Cancel this execution?"
        message="Runs still in progress are stopped. Completed runs are kept."
        confirmLabel="Cancel execution"
        onConfirm={() => cancel.mutate()}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Run — live stage timeline, the decisions it is waiting on, and control.
//
// A stage parked in `awaiting_input` blocks everything downstream and costs
// seconds to unblock, so decisions float to the top. Failed and paused
// stages surface too, but with the action that actually applies to them
// (Retry / Resume) — never with approval buttons.
//
// Live: the `run` stream scope drives refreshes while the screen is open;
// polling stays on as a slow safety net and stops once the run is terminal.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileDiff, Lock, MoreHorizontal, TerminalSquare, Trash2, Workflow as WorkflowIcon } from 'lucide-react-native';
import { queryKeys, type ApprovalOutcome, type StageRunSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useRunMutations, useRunPermissionMode, type RunAction } from '../../src/api/useRunControl';
import { useRunStream } from '../../src/stream/useRunStream';
import { ApprovalCard } from '../../src/components/runs/ApprovalCard';
import { formatDuration, relativeTime, runElapsed } from '../../src/components/runs/formatTime';
import { StageTimeline } from '../../src/components/runs/StageTimeline';
import { StatusGlyph } from '../../src/components/runs/StatusGlyph';
import {
  awaitsApproval,
  pollIntervalFor,
  runControlsFor,
  runTitle,
} from '../../src/components/runs/runModel';
import { isActive, isTerminal, statusLabel } from '../../src/components/runs/statusStyle';
import { PermissionModeChip, PermissionModeSheet } from '../../src/components/runs/PermissionModeSheet';
import { toneOf } from '../../src/components/runs/tone';
import { useFeature } from '../../src/components/runs/useFeature';
import { usePullRefresh } from '../../src/components/runs/usePullRefresh';
import { Card, SectionHeader, TONE_TEXT } from '../../src/components/ui/primitives';
import { ActionSheet, type MenuAction } from '../../src/components/ui/ActionSheet';
import { Button, IconButton } from '../../src/components/ui/Button';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { PlainScroll } from '../../src/components/ui/Screen';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { useTheme } from '../../src/theme/ThemeProvider';

const ACTION_LABEL: Record<RunAction, string> = {
  pause: 'Pause run',
  resume: 'Resume run',
  cancel: 'Cancel run',
  retry: 'Retry run',
};

export default function RunDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const runId = String(id);
  const api = useApi();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { colors } = useTheme();
  const terminalGate = useFeature('terminal');
  const runControl = useFeature('runControl');
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [modeSheet, setModeSheet] = useState(false);

  const { connected } = useRunStream(runId, focused);
  const { runAction, stageAction, approve, remove } = useRunMutations(runId);

  const run = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => api.runs.get(runId),
    refetchInterval: (query) => (focused ? pollIntervalFor(query.state.data?.status, connected) : false),
  });

  const runStatus = run.data?.status;
  // Only a run that can still call tools has a mode worth showing.
  const live = Boolean(runStatus) && !isTerminal(runStatus ?? '');
  const { mode: permissionMode, setMode } = useRunPermissionMode(runId, live);
  const interrupts = useQuery({
    queryKey: queryKeys.runInterrupts(runId),
    queryFn: () => api.runs.pendingInterrupts(runId),
    enabled: Boolean(run.data?.stageRuns?.some((s) => awaitsApproval(s.status))),
    refetchInterval: focused ? pollIntervalFor(runStatus, connected) : false,
  });

  const pull = usePullRefresh(() => Promise.all([run.refetch(), interrupts.refetch()]));

  const stages = run.data?.stageRuns ?? [];
  const approvals = useMemo(() => stages.filter((s) => awaitsApproval(s.status)), [stages]);
  const controls = runControlsFor(runStatus ?? '');

  const doRunAction = useCallback(
    (action: RunAction) => {
      runAction.mutate(action, {
        onSuccess: ({ newRunId }) => {
          if (newRunId && newRunId !== runId) router.replace(`/runs/${newRunId}`);
        },
      });
    },
    [runAction, runId],
  );

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: runTitle(run.data?.name, 'Run'),
      headerRight: () =>
        run.data ? (
          <IconButton
            icon={<MoreHorizontal size={20} color={colors.foreground} />}
            accessibilityLabel="Run actions"
            onPress={() => setMenu(true)}
          />
        ) : null,
    });
  }, [navigation, run.data, colors.foreground]);

  const decide = useCallback(
    (stage: StageRunSummary, outcome: ApprovalOutcome, feedback?: string) => {
      setBusyStage(stage.id);
      approve.mutate(
        { stageRunId: stage.id, outcome, ...(feedback ? { feedback } : {}) },
        { onSettled: () => setBusyStage(null) },
      );
    },
    [approve],
  );

  const openStage = useCallback(
    (stage: StageRunSummary) =>
      router.push({
        pathname: '/runs/[id]/stages/[stageRunId]',
        params: { id: runId, stageRunId: stage.id },
      } as never),
    [runId],
  );

  if (run.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={5} />
      </View>
    );
  }
  if (run.error || !run.data) {
    return (
      <ErrorState
        title={run.error ? 'Could not load this run' : 'Run not found'}
        message={run.error instanceof Error ? run.error.message : undefined}
        onRetry={() => void run.refetch()}
      />
    );
  }

  const data = run.data;
  const elapsed = runElapsed(data, isActive(data.status) ? null : data.completedAt ?? data.updatedAt);
  const workspaceId = data.workspaceId;

  const menuActions: MenuAction[] = runControl.available
    ? [
        ...(['pause', 'resume', 'retry', 'cancel'] as const)
          .filter((action) => controls[action])
          .map((action) => ({
            label: ACTION_LABEL[action],
            destructive: action === 'cancel',
            onPress: () => (action === 'cancel' ? setConfirmCancel(true) : doRunAction(action)),
          })),
        {
          label: 'Delete run',
          destructive: true,
          icon: <Trash2 size={18} color={colors.danger} />,
          onPress: () => setConfirmDelete(true),
        },
      ]
    : [
        {
          label: 'Request access',
          detail: 'Pausing, cancelling and retrying runs needs workflow permission on this device.',
          icon: <Lock size={18} color={colors['muted-foreground']} />,
          onPress: runControl.requestAccess,
        },
      ];

  // The single most relevant control, inline, so it is not hidden in a menu.
  const primary: RunAction | null = controls.resume ? 'resume' : controls.retry ? 'retry' : null;

  return (
    <View className="flex-1 bg-background">
      <PlainScroll onRefresh={pull.onRefresh} refreshing={pull.refreshing}>
        <Card className="gap-3 p-4">
          <View className="flex-row items-start gap-3">
            <StatusGlyph status={data.status} />
            <View className="flex-1 gap-0.5">
              <Text className="text-lg font-semibold leading-snug text-foreground">{runTitle(data.name, 'Run')}</Text>
              <Text className="text-sm text-muted-foreground">
                <Text className={`font-medium ${TONE_TEXT[toneOf(data.status)]}`}>{statusLabel(data.status)}</Text>
                {` · started ${relativeTime(data.startedAt ?? data.createdAt)}`}
                {elapsed != null ? ` · ${formatDuration(elapsed)}` : ''}
              </Text>
            </View>
          </View>
          {live && permissionMode.data ? (
            <View className="flex-row items-center gap-2">
              <Text className="text-sm text-muted-foreground">Permissions</Text>
              <PermissionModeChip
                mode={permissionMode.data}
                disabled={!runControl.available || setMode.isPending}
                onPress={() => setModeSheet(true)}
              />
            </View>
          ) : null}
          {data.error ? (
            <View className="rounded-2xl border border-danger bg-danger-muted p-3">
              <Text className="text-sm text-foreground">{data.error}</Text>
            </View>
          ) : null}
          {primary && runControl.available ? (
            <Button
              label={ACTION_LABEL[primary]}
              variant={primary === 'retry' ? 'primary' : 'secondary'}
              full
              haptic="commit"
              loading={runAction.isPending}
              disabled={runAction.isPending}
              onPress={() => doRunAction(primary)}
            />
          ) : null}
        </Card>

        {approvals.length > 0 ? (
          <>
            <SectionHeader title="Waiting for you" />
            {approvals.map((stage) => (
              <ApprovalCard
                key={stage.id}
                stage={stage}
                interruptData={interrupts.data?.find((i) => i.id === stage.id)?.interruptData}
                busy={busyStage === stage.id}
                onDecide={(outcome, feedback) => decide(stage, outcome, feedback)}
                {...(stage.sessionId ? { onOpenStage: () => openStage(stage) } : {})}
              />
            ))}
          </>
        ) : null}

        <SectionHeader title={`Stages (${stages.length})`} />
        {stages.length === 0 ? (
          <EmptyState title="No stages yet" message="Stages appear as the run reaches them." />
        ) : (
          <StageTimeline
            stages={stages}
            runStatus={data.status}
            canControl={runControl.available}
            busyStageId={busyStage}
            onOpen={openStage}
            onAction={(stage, action) => {
              setBusyStage(stage.id);
              stageAction.mutate(
                { stageRunId: stage.id, action },
                { onSettled: () => setBusyStage(null) },
              );
            }}
          />
        )}

        <SectionHeader title="More" />
        <ListGroup>
          {workspaceId ? (
            <ListRow
              title="Changes"
              subtitle="Files this run created or edited"
              icon={<FileDiff size={18} color={colors['muted-foreground']} />}
              onPress={() => router.push(`/changes/${workspaceId}`)}
            />
          ) : null}
          {workspaceId && terminalGate.available ? (
            <ListRow
              title="Terminal"
              subtitle="Run commands in this workspace"
              icon={<TerminalSquare size={18} color={colors['muted-foreground']} />}
              onPress={() => router.push(`/terminal/${workspaceId}`)}
            />
          ) : null}
          <ListRow
            title="Workflow"
            subtitle="The definition this run executes"
            icon={<WorkflowIcon size={18} color={colors['muted-foreground']} />}
            onPress={() => router.push(`/workflows/${data.workflowDefinitionId}`)}
          />
        </ListGroup>
      </PlainScroll>

      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={runTitle(data.name, 'Run')}
        actions={menuActions}
      />
      <ActionSheet
        visible={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel this run?"
        message="Running stages stop and nothing after them starts. You can retry it later as a new run."
        actions={[{ label: 'Cancel run', destructive: true, onPress: () => doRunAction('cancel') }]}
      />
      <ActionSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this run?"
        message={
          isActive(data.status)
            ? 'It is still running — it will be cancelled first. Its stages and history are removed for good.'
            : 'Its stages and history are removed for good. The workflow itself is kept.'
        }
        actions={[
          {
            label: 'Delete run',
            destructive: true,
            onPress: () =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  if (router.canGoBack()) router.back();
                  else router.replace('/(tabs)/runs');
                },
              }),
          },
        ]}
      />
      {permissionMode.data ? (
        <PermissionModeSheet
          visible={modeSheet}
          onClose={() => setModeSheet(false)}
          current={permissionMode.data}
          onChange={(next) => setMode.mutate(next)}
        />
      ) : null}
    </View>
  );
}

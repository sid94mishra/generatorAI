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
import { ChevronLeft, Lock, MoreHorizontal, Trash2, Workflow as WorkflowIcon } from 'lucide-react-native';
import { queryKeys, type ApprovalOutcome, type StageRunSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useAdminApi } from '../../src/api/useAdminApi';
import { useRunMutations, useRunPermissionMode, type RunAction } from '../../src/api/useRunControl';
import { useRunStream } from '../../src/stream/useRunStream';
import { StageGateCard } from '../../src/components/runs/StageGateCard';
import { LoopDecisionCard } from '../../src/components/runs/LoopDecisionCard';
import { CheckOutput } from '../../src/components/runs/CheckOutput';
import { isCheckStage, isParkedLoop, waitOf, type RunStage } from '../../src/components/runs/loopModel';
import { WaitDecisionCard, type WaitDecision } from '../../src/components/runs/WaitDecisionCard';
import { formatDuration, relativeTime, runElapsed } from '../../src/components/runs/formatTime';
import { StageTimeline } from '../../src/components/runs/StageTimeline';
import { StageTranscriptInline } from '../../src/components/runs/StageTranscriptInline';
import { SessionHeader } from '../../src/components/chat/ChatHeader';
import { SidePanelHost } from '../../src/components/ui/SidePanel';
import { WorkbenchPanel } from '../../src/components/workbench/WorkbenchPanel';
import { WorkbenchSheet } from '../../src/components/workbench/WorkbenchSheet';
import { WorkbenchButton } from '../../src/components/workbench/WorkbenchButton';
import { useWorkbench } from '../../src/components/workbench/useWorkbench';
import type { ToolId } from '../../src/components/workbench/workbenchModel';
import { MAX_SCALE } from '../../src/components/ui/accessibility';
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
import { PlainScroll, goBack } from '../../src/components/ui/Screen';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { useTheme } from '../../src/theme/ThemeProvider';

const ACTION_LABEL: Record<RunAction, string> = {
  pause: 'Pause run',
  resume: 'Resume run',
  cancel: 'Cancel run',
  retry: 'Retry failed',
};

export default function RunDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const runId = String(id);
  const api = useApi();
  const admin = useAdminApi();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { colors } = useTheme();
  const runControl = useFeature('runControl');
  // Retry forks a new run (an invocation), which needs only runStart.
  const runStart = useFeature('runStart');
  // The workbench: tools for the run's workspace, as on a chat.
  const [panelOpen, setPanelOpen] = useState(false);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [toolOpen, setToolOpen] = useState(false);
  // One step open at a time. `undefined` = the user has not chosen, so the
  // running step is shown; `null` = they collapsed it and it stays shut.
  const [expanded, setExpanded] = useState<string | null | undefined>(undefined);
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
  const pull = usePullRefresh(() => run.refetch());

  const stages = run.data?.stageRuns ?? [];
  // A parked loop is answered with the loop's own decisions, not an approval.
  const approvals = useMemo(
    () => stages.filter((s) => awaitsApproval(s.status) && !isParkedLoop(s as RunStage)),
    [stages],
  );
  const loopDecisions = useMemo(() => stages.filter((s) => isParkedLoop(s as RunStage)) as RunStage[], [stages]);
  // Waits (P05 §4.3) and the decisions of sub-workflow children, mirrored here (P05 §4.2).
  const hasChildren = stages.some((s) => (s as RunStage).kind === 'subworkflow' && s.status === 'running');
  const pending = useQuery({
    queryKey: [...queryKeys.run(runId), 'pending-decisions'],
    queryFn: () => admin.runs.pendingDecisions(runId),
    enabled: hasChildren,
    refetchInterval: focused && hasChildren ? 5_000 : false,
  });
  const waitDecisions = useMemo<WaitDecision[]>(() => {
    const out: WaitDecision[] = [];
    for (const s of stages as RunStage[]) {
      const w = waitOf(s);
      if (!w || s.status !== 'waiting' || w.type === 'timer') continue;
      out.push({
        runId,
        instanceId: s.id,
        name: w.label ?? s.name ?? s.stageKey,
        type: w.type,
        prompt: w.prompt,
        form: w.form,
        eventKey: w.eventKey,
        callbackUrl: s.callback?.url ?? null,
      });
    }
    for (const d of pending.data ?? []) {
      if (d.runId === runId) continue;
      const i = (d.interruptData && typeof d.interruptData === 'object' ? d.interruptData : {}) as Record<string, unknown>;
      const type = d.kind === 'wait' ? (d.waitType === 'event' ? 'event' : 'approval') : d.kind === 'stage_completion_review' ? 'completion_review' : null;
      if (!type) continue;
      out.push({
        runId,
        instanceId: d.instanceId,
        name: d.name,
        via: d.via.map((v) => v.name).join(' › '),
        type,
        prompt: typeof i['prompt'] === 'string' ? i['prompt'] : typeof i['reason'] === 'string' ? i['reason'] : null,
        form: i['form'] && typeof i['form'] === 'object' ? (i['form'] as Record<string, unknown>) : null,
        eventKey: typeof i['eventKey'] === 'string' ? i['eventKey'] : null,
        callbackUrl: d.callback?.url ?? null,
      });
    }
    return out;
  }, [stages, pending.data, runId]);
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

  // The navigator header is off for this route: the screen draws its own so
  // the workbench panel can slide over it (as on a chat).
  React.useLayoutEffect(() => {
    navigation.setOptions({ title: runTitle(run.data?.name, 'Run'), gestureEnabled: !panelOpen });
  }, [navigation, run.data?.name, panelOpen]);

  const workbench = useWorkbench({
    surface: 'run',
    workspaceId: run.data?.workspaceId ?? null,
    scopes: runControl.scopes,
    live: panelOpen || toolOpen,
  });

  const openTool = useCallback((next: ToolId) => {
    setPanelOpen(false);
    setTool(next);
    setToolOpen(true);
  }, []);

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

  const definitionId = run.data?.workflowDefinitionId;
  const workflowHref = (
    definitionId ? `/workflows/${encodeURIComponent(definitionId)}` : '/(tabs)/runs?segment=workflows'
  ) as NonNullable<Parameters<typeof goBack>[0]>;
  const backButton = (
    <IconButton
      accessibilityLabel="Back"
      icon={<ChevronLeft size={24} color={colors.foreground} />}
      // A run belongs to its workflow (desktop: /workflows/:id/runs/:runId), so
      // with no history behind it Back lands on that workflow's page.
      onPress={() => goBack(workflowHref)}
    />
  );
  const headerTitle = (text: string, sub?: string): React.ReactElement => (
    <View>
      <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-md font-semibold text-foreground">
        {text}
      </Text>
      {sub ? (
        <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs text-muted-foreground">
          {sub}
        </Text>
      ) : null}
    </View>
  );

  if (run.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <SessionHeader leading={backButton} title={headerTitle('Run')} trailing={null} />
        <View className="p-4">
          <SkeletonList rows={5} />
        </View>
      </View>
    );
  }
  if (run.error || !run.data) {
    return (
      <View className="flex-1 bg-background">
        <SessionHeader leading={backButton} title={headerTitle('Run')} trailing={null} />
        <ErrorState
        title={run.error ? 'Could not load this run' : 'Run not found'}
        message={run.error instanceof Error ? run.error.message : undefined}
        onRetry={() => void run.refetch()}
        />
      </View>
    );
  }

  const data = run.data;
  const runningStage = stages.find((st) => isActive(st.status));
  const expandedStageId = expanded === undefined ? (runningStage?.id ?? null) : expanded;
  const elapsed = runElapsed(data, isActive(data.status) ? null : data.completedAt ?? data.updatedAt);
  const workspaceId = data.workspaceId;

  const allowed = (action: RunAction): boolean => (action === 'retry' ? runStart.available : runControl.available);
  const menuActions: MenuAction[] = [
    ...(['pause', 'resume', 'retry', 'cancel'] as const)
      .filter((action) => controls[action] && allowed(action))
      .map((action) => ({
        label: ACTION_LABEL[action],
        destructive: action === 'cancel',
        onPress: () => (action === 'cancel' ? setConfirmCancel(true) : doRunAction(action)),
      })),
    ...(runControl.available
      ? [
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
            detail: 'Pausing, cancelling and deleting runs needs workflow permission on this device.',
            icon: <Lock size={18} color={colors['muted-foreground']} />,
            onPress: runControl.requestAccess,
          },
        ]),
  ];

  // The single most relevant control, inline, so it is not hidden in a menu.
  const primary: RunAction | null = controls.resume ? 'resume' : controls.retry ? 'retry' : null;

  return (
    <View className="flex-1 bg-background">
      <SidePanelHost
        side="right"
        open={panelOpen}
        onOpenChange={setPanelOpen}
        swipeToOpen={false}
        accessibilityLabel="Workbench"
        renderPanel={() => (
          <WorkbenchPanel
            subtitle={runTitle(data.name, 'Run')}
            tools={workbench.tools}
            activeTool={toolOpen ? tool : null}
            onPick={openTool}
            onClose={() => setPanelOpen(false)}
          />
        )}
      >
      <SessionHeader
        leading={backButton}
        title={headerTitle(runTitle(data.name, 'Run'), statusLabel(data.status))}
        trailing={
          <>
            {workspaceId ? (
              <WorkbenchButton badge={workbench.badge} selected={panelOpen} onPress={() => setPanelOpen((v) => !v)} />
            ) : null}
            <IconButton
              icon={<MoreHorizontal size={20} color={colors.foreground} />}
              accessibilityLabel="Run actions"
              onPress={() => setMenu(true)}
            />
          </>
        }
      />
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
          {primary && allowed(primary) ? (
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

        {approvals.length + loopDecisions.length + waitDecisions.length > 0 ? (
          <>
            <SectionHeader title="Waiting for you" />
            {/* A loop decision is a run-time act, like an approval (exec:agent, P05). */}
            {loopDecisions.map((stage) => (
              <LoopDecisionCard
                key={stage.id}
                runId={runId}
                stage={stage}
                canControl={runStart.available}
                onRequestAccess={runStart.requestAccess}
              />
            ))}
            {waitDecisions.map((d) => (
              <WaitDecisionCard key={`${d.via ?? ''}:${d.instanceId}`} decision={d} canDecide={runStart.available} />
            ))}
            {/* A tool permission, question or plan inside a stage's turn is the
                chat's card; the completion review is the approval card. */}
            {approvals.map((stage) => (
              <StageGateCard
                key={stage.id}
                runId={runId}
                stage={stage}
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
            canControl={isTerminal(data.status) ? runStart.available : runControl.available}
            busyStageId={busyStage}
            onOpen={openStage}
            expandedId={expandedStageId}
            onToggle={(stage) => setExpanded(expandedStageId === stage.id ? null : stage.id)}
            renderExpanded={(stage) =>
              isCheckStage(stage as RunStage) ? (
                <CheckOutput stage={stage as RunStage} />
              ) : (
              <StageTranscriptInline
                runId={runId}
                stage={stage}
                workspaceId={workspaceId ?? null}
                connected={connected}
                onOpenStage={() => openStage(stage)}
              />
              )
            }
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
          <ListRow
            title="Workflow"
            subtitle="The definition this run executes"
            icon={<WorkflowIcon size={18} color={colors['muted-foreground']} />}
            onPress={() => router.push(`/workflows/${data.workflowDefinitionId}`)}
          />
        </ListGroup>
      </PlainScroll>
      </SidePanelHost>

      <WorkbenchSheet
        visible={toolOpen}
        onClose={() => setToolOpen(false)}
        tool={tool}
        onToolChange={setTool}
        tools={workbench.tools}
        workspaceId={workspaceId ?? null}
        scopes={runControl.scopes}
      />

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
                  else router.replace(workflowHref);
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

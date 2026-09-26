// ────────────────────────────────────────────────────────────────
// Stage — one stage run: what the agent did, what it produced, what it
// touched, and the controls that apply to it.
//
// Transcript: the stage session's persisted messages
// (`GET /sessions/:sessionId/chat?stageRunId=`), rendered through the chat
// timeline read-only. Output: the harness summary and raw output text.
// Files: the stage's artifact manifest, opening into the run's Changes.
//
// Live through the same `run` stream scope as the run screen — its
// invalidations cover this screen's keys, which sit under `queryKeys.run`.
//
// A stage is a compact chat (P03b): the chat's composer sits under the
// transcript (send, attach, Stop), and a tool permission, question or plan
// inside the stage's turn pins the chat's card above it. A message to a
// completed stage amends its output; its stream stays open while it does.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, MessageSquare } from 'lucide-react-native';
import { queryKeys, type ApprovalOutcome, type StageRunSummary } from '@generatorai/client-core';

import { useApi } from '../../../../src/api/useApi';
import { useAdminApi } from '../../../../src/api/useAdminApi';
import { useRunMutations, type StageAction } from '../../../../src/api/useRunControl';
import { useRunStream } from '../../../../src/stream/useRunStream';
import { ApprovalCard } from '../../../../src/components/runs/ApprovalCard';
import { StageComposer } from '../../../../src/components/runs/StageComposer';
import { stageGateOf } from '../../../../src/components/runs/stageGate';
import { formatDuration, relativeTime, runElapsed } from '../../../../src/components/runs/formatTime';
import { StatusGlyph } from '../../../../src/components/runs/StatusGlyph';
import { stageSubtitle } from '../../../../src/components/runs/StageTimeline';
import { awaitsApproval, pollIntervalFor, stageControlsFor } from '../../../../src/components/runs/runModel';
import { isActive, isTerminal } from '../../../../src/components/runs/statusStyle';
import { transcriptItems, withLiveRows, type TranscriptItem } from '../../../../src/components/runs/stageTranscript';
import { deriveTimeline } from '../../../../src/components/chat/timeline/deriveTimeline';
import { useStageLive } from '../../../../src/stream/useStageLive';
import { useFeature } from '../../../../src/components/runs/useFeature';
import { usePullRefresh } from '../../../../src/components/runs/usePullRefresh';
import { TimelineActionsContext } from '../../../../src/components/chat/timeline/TimelineActions';
import { TimelineRowView } from '../../../../src/components/chat/timeline/TimelineRow';
import { UserMessageRow } from '../../../../src/components/chat/timeline/UserMessageRow';
import { Markdown } from '../../../../src/components/markdown/Markdown';
import { ActionSheet } from '../../../../src/components/ui/ActionSheet';
import { Button } from '../../../../src/components/ui/Button';
import { Card, SectionHeader } from '../../../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../../../src/components/ui/ListRow';
import { SegmentedControl } from '../../../../src/components/ui/SegmentedControl';
import { EmptyState, ErrorState } from '../../../../src/components/ui/States';
import { SkeletonList } from '../../../../src/components/ui/Skeleton';
import { useToast } from '../../../../src/components/ui/Toast';
import { useTheme } from '../../../../src/theme/ThemeProvider';

type Tab = 'transcript' | 'output' | 'files';

const ACTION_LABEL: Record<StageAction, string> = {
  retry: 'Retry stage',
  resume: 'Resume stage',
  cancel: 'Cancel stage',
};

type ListItem =
  | { kind: 'transcript'; item: TranscriptItem }
  | { kind: 'block'; id: string; node: React.ReactNode };

export default function StageScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id: string; stageRunId: string }>();
  const runId = String(params.id);
  const stageRunId = String(params.stageRunId);
  const api = useApi();
  const admin = useAdminApi();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { colors } = useTheme();
  const toast = useToast();
  const runControl = useFeature('runControl');
  const [tab, setTab] = useState<Tab>('transcript');
  const [confirmCancel, setConfirmCancel] = useState(false);
  // A message to a completed stage amends it: stream it until the amendment lands.
  const [amendingSince, setAmendingSince] = useState<string | null>(null);

  const { connected } = useRunStream(runId, focused);
  const { stageAction, approve } = useRunMutations(runId);

  const run = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => api.runs.get(runId),
    refetchInterval: (query) => (focused ? pollIntervalFor(query.state.data?.status, connected) : false),
  });

  const stage: StageRunSummary | undefined = run.data?.stageRuns?.find((s) => s.id === stageRunId);
  const sessionId = stage?.sessionId ?? null;
  const live = stage ? isActive(stage.status) : false;

  const transcript = useQuery({
    queryKey: queryKeys.stageTranscript(runId, stageRunId),
    queryFn: () => admin.sessions.chat(sessionId!, stageRunId),
    enabled: Boolean(sessionId) && tab === 'transcript',
    refetchInterval: focused && live ? (connected ? 15_000 : 5_000) : false,
  });

  const pull = usePullRefresh(() => Promise.all([run.refetch(), transcript.refetch()]));

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: stage?.name ?? 'Stage' });
  }, [navigation, stage?.name]);

  // Nothing past the prompt is saved while the stage runs; stream it instead.
  const amending = amendingSince !== null && String(stage?.amendedAt ?? '') === amendingSince;
  const liveState = useStageLive(runId, stageRunId, live || amending);
  const streaming =
    (live || amending) && (liveState?.status === 'pending' || liveState?.status === 'streaming' || liveState?.status === 'thinking');
  const items = useMemo(() => {
    const saved = transcriptItems(transcript.data, live);
    if (!liveState?.blocks.length) return saved;
    return withLiveRows(saved, deriveTimeline(liveState.blocks, { active: true, idPrefix: `live-${stageRunId}:` }));
  }, [transcript.data, live, liveState?.blocks, stageRunId]);
  const actions = useMemo(
    () => ({ workspaceId: run.data?.workspaceId ?? null, streamKey: null, toast: (message: string) => toast({ message }) }),
    [run.data?.workspaceId, toast],
  );

  if (run.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={5} />
      </View>
    );
  }
  if (run.isError) return <ErrorState message="Could not load this run." onRetry={() => void run.refetch()} />;
  if (!stage || !run.data) {
    return <ErrorState title="Stage not found" message="It may belong to a run that was retried." />;
  }

  const runStatus = run.data.status;
  const workspaceId = run.data.workspaceId;
  const controls = stageControlsFor(stage.status, runStatus);
  const available = (['retry', 'resume', 'cancel'] as const).filter((a) => controls[a]);
  const elapsed = runElapsed(stage, isActive(stage.status) ? null : stage.completedAt);
  const files = (stage.artifactManifest ?? []).filter((f) => !/^unnamed\.[A-Za-z0-9]+$/.test(f.path));
  const outputText = stage.outputText?.trim();
  const summary = stage.summary?.trim();

  const runStage = (action: StageAction): void => {
    if (action === 'cancel') {
      setConfirmCancel(true);
      return;
    }
    stageAction.mutate({ stageRunId, action });
  };

  const header = (
    <View className="gap-3 px-4 pb-3 pt-4">
      <Card className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <StatusGlyph status={stage.status} />
          <View className="flex-1 gap-0.5">
            <Text className="text-lg font-semibold leading-snug text-foreground">
              {stage.name ?? stage.stageKey}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {stageSubtitle(stage)}
              {stage.startedAt ? ` · started ${relativeTime(stage.startedAt)}` : ''}
              {elapsed != null ? ` · ${formatDuration(elapsed)}` : ''}
            </Text>
          </View>
        </View>
        {stage.error ? (
          <View className="rounded-2xl border border-danger bg-danger-muted p-3">
            <Text className="text-sm text-foreground">{stage.error}</Text>
          </View>
        ) : null}
        {available.length > 0 ? (
          runControl.available ? (
            <View className="flex-row flex-wrap gap-2">
              {available.map((action) => (
                <Button
                  key={action}
                  label={ACTION_LABEL[action]}
                  variant={action === 'cancel' ? 'ghost' : action === 'retry' ? 'primary' : 'secondary'}
                  size="md"
                  haptic="commit"
                  loading={stageAction.isPending && stageAction.variables?.action === action}
                  disabled={stageAction.isPending}
                  onPress={() => runStage(action)}
                />
              ))}
            </View>
          ) : (
            <View className="flex-row items-center gap-3">
              <Text className="flex-1 text-sm text-muted-foreground">
                Retrying or resuming stages needs workflow permission on this device.
              </Text>
              <Button label="Request access" variant="secondary" size="sm" onPress={runControl.requestAccess} />
            </View>
          )
        ) : null}
      </Card>

      {awaitsApproval(stage.status) && stageGateOf(stage.interruptData).kind === 'review' ? (
        <ApprovalCard
          stage={stage}
          busy={approve.isPending}
          onDecide={(outcome: ApprovalOutcome, feedback?: string) =>
            approve.mutate({ stageRunId, outcome, ...(feedback ? { feedback } : {}) })
          }
        />
      ) : null}

      <SegmentedControl<Tab>
        segments={[
          { value: 'transcript', label: 'Transcript' },
          { value: 'output', label: 'Output' },
          { value: 'files', label: 'Files', ...(files.length > 0 ? { count: files.length } : {}) },
        ]}
        value={tab}
        onChange={setTab}
        accessibilityLabel="Stage detail"
      />
    </View>
  );

  let data: ListItem[] = [];
  let empty: React.ReactElement | null = null;

  if (tab === 'transcript') {
    if (!sessionId) {
      empty = (
        <EmptyState
          title={isTerminal(stage.status) || stage.status === 'skipped' ? 'No transcript' : 'Not started yet'}
          message={isTerminal(stage.status) ? 'This stage ran without an agent session.' : 'The transcript appears once the stage starts.'}
          icon={<MessageSquare size={22} color={colors['muted-foreground']} />}
        />
      );
    } else if (transcript.isLoading) {
      empty = (
        <View className="px-4">
          <SkeletonList rows={4} />
        </View>
      );
    } else if (transcript.isError) {
      empty = <ErrorState message="Could not load the transcript." onRetry={() => void transcript.refetch()} />;
    } else {
      data = items.map((item) => ({ kind: 'transcript', item }));
      empty = <EmptyState title="No messages yet" message={live ? 'The agent is starting up.' : undefined} compact />;
    }
  } else if (tab === 'output') {
    if (summary) {
      data.push({
        kind: 'block',
        id: 'summary',
        node: (
          <View className="px-4">
            <SectionHeader title="Summary" />
            <Card className="p-4">
              <Markdown content={summary} />
            </Card>
          </View>
        ),
      });
    }
    if (outputText && outputText !== summary) {
      data.push({
        kind: 'block',
        id: 'output',
        node: (
          <View className="px-4">
            <SectionHeader title="Output" />
            <Card className="p-4">
              <Markdown content={outputText} />
            </Card>
          </View>
        ),
      });
    }
    if (stage.outputData && Object.keys(stage.outputData).length > 0) {
      data.push({
        kind: 'block',
        id: 'data',
        node: (
          <View className="px-4">
            <SectionHeader title="Structured output" />
            <Card className="p-4">
              <Text selectable className="font-mono text-sm text-foreground">
                {JSON.stringify(stage.outputData, null, 2)}
              </Text>
            </Card>
          </View>
        ),
      });
    }
    empty = (
      <EmptyState
        title="No output yet"
        message={live ? 'Output appears when the stage finishes.' : 'This stage recorded no output.'}
        icon={<FileText size={22} color={colors['muted-foreground']} />}
      />
    );
  } else {
    if (files.length > 0) {
      data.push({
        kind: 'block',
        id: 'files',
        node: (
          <View className="px-4">
            <ListGroup>
              {files.map((file) => (
                <ListRow
                  key={file.path}
                  title={file.path.split(/[\\/]/).pop() ?? file.path}
                  subtitle={`${file.action} · ${file.path}`}
                  icon={<FileText size={18} color={colors['muted-foreground']} />}
                  {...(workspaceId
                    ? {
                        onPress: () =>
                          router.push({
                            pathname: '/changes/[workspaceId]/file',
                            params: { workspaceId, path: file.path },
                          } as never),
                      }
                    : {})}
                />
              ))}
            </ListGroup>
            {workspaceId ? (
              <View className="pt-3">
                <Button
                  label="All changes in this run"
                  variant="secondary"
                  full
                  onPress={() => router.push(`/changes/${workspaceId}`)}
                />
              </View>
            ) : null}
          </View>
        ),
      });
    }
    empty = (
      <EmptyState
        title="No files"
        message="Files this stage writes are listed here."
        icon={<FileText size={22} color={colors['muted-foreground']} />}
        {...(workspaceId ? { action: { label: 'Open run changes', onPress: () => router.push(`/changes/${workspaceId}`) } } : {})}
      />
    );
  }

  return (
    <TimelineActionsContext.Provider value={actions}>
      <View className="flex-1 bg-background">
      <FlatList<ListItem>
        className="flex-1 bg-background"
        data={data}
        keyExtractor={(item) => (item.kind === 'transcript' ? item.item.id : item.id)}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors['muted-foreground']} />
        }
        renderItem={({ item }) =>
          item.kind === 'block' ? (
            <>{item.node}</>
          ) : (
            // Same gutter and rhythm as the chat list these rows come from.
            <View className="px-4 pb-2.5">
              {item.item.kind === 'user' ? (
                <UserMessageRow message={item.item.message} />
              ) : (
                <TimelineRowView row={item.item.row} />
              )}
            </View>
          )
        }
      />
      <StageComposer
        runId={runId}
        stage={stage}
        workspaceId={workspaceId ?? null}
        streaming={streaming}
        canControl={runControl.available}
        busy={approve.isPending}
        onDecide={(outcome: ApprovalOutcome, feedback?: string) =>
          approve.mutate({ stageRunId, outcome, ...(feedback ? { feedback } : {}) })
        }
        onAmending={() => setAmendingSince(String(stage.amendedAt ?? ''))}
      />
      </View>

      <ActionSheet
        visible={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel this stage?"
        message="The agent stops. Stages after it will not start."
        actions={[
          {
            label: 'Cancel stage',
            destructive: true,
            onPress: () => stageAction.mutate({ stageRunId, action: 'cancel' }),
          },
        ]}
      />
    </TimelineActionsContext.Provider>
  );
}

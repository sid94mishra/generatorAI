// ────────────────────────────────────────────────────────────────
// Run detail — stage timeline, live status, and the HITL gate.
//
// The gate is the reason this screen exists on a phone. A stage parked in
// `awaiting_input` blocks everything downstream, costs seconds to unblock,
// and otherwise waits until someone returns to a desk. So blocked stages
// float to the top and every other section is subordinate to them.
//
// Run CONTROL (start / pause / cancel / retry) is deliberately absent: the
// route policy requires `write:workflows`, which a paired mobile device does
// not hold. Rather than render buttons that 403, the screen says where those
// controls live. See packages/auth/src/routePolicy.ts.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { FileDiff, Info, TerminalSquare } from 'lucide-react-native';
import { queryKeys, type StageRunSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature } from '../../src/auth/featureGate';
import { formatDuration, relativeTime, runElapsed } from '../../src/components/runs/formatTime';
import {
  isActive,
  isTerminal,
  needsAttention,
  statusLabel,
} from '../../src/components/runs/statusStyle';
import { Badge, Card, SectionHeader, StatusDot, type Tone } from '../../src/components/ui/primitives';
import { Button } from '../../src/components/ui/Button';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { PlainScroll } from '../../src/components/ui/Screen';
import { EmptyState, ErrorState, Spinner } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { haptics } from '../../src/components/ui/haptics';
import { useTheme } from '../../src/theme/ThemeProvider';

type Outcome = 'approved' | 'changes_requested' | 'rejected';

function toneOf(status: string): Tone {
  if (needsAttention(status)) return status === 'failed' ? 'danger' : 'warning';
  if (isActive(status)) return 'info';
  if (status === 'completed') return 'success';
  return 'neutral';
}

export default function RunDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const runId = String(id);
  const api = useApi();
  const navigation = useNavigation();
  const { state } = useAuth();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [busyStage, setBusyStage] = useState<string | null>(null);

  const scopes = state.status === 'authenticated' ? state.scopes : [];
  const terminalGate = checkFeature('terminal', scopes);
  const runControl = checkFeature('runControl', scopes);

  const run = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => api.runs.get(runId),
    // Poll while in flight; stop once terminal so a finished run does not
    // keep a phone's radio awake for nothing.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTerminal(status) ? false : 5_000;
    },
  });

  const interrupts = useQuery({
    queryKey: queryKeys.runInterrupts(runId),
    queryFn: () => api.runs.pendingInterrupts(runId),
    refetchInterval: 5_000,
  });

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: run.data?.name ?? 'Run' });
  }, [navigation, run.data?.name]);

  const approve = useMutation({
    mutationFn: (input: { stageId: string; outcome: Outcome }) =>
      api.runs.approve(runId, input.stageId, {
        outcome: input.outcome,
        approved: input.outcome === 'approved',
      }),
    onSuccess: async (_data, input) => {
      if (input.outcome === 'approved') haptics.success();
      else haptics.error();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.runInterrupts(runId) }),
      ]);
    },
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not submit', err instanceof Error ? err.message : String(err));
    },
    onSettled: () => setBusyStage(null),
  });

  const decide = useCallback(
    (stageId: string, outcome: Outcome) => {
      setBusyStage(stageId);
      approve.mutate({ stageId, outcome });
    },
    [approve],
  );

  const stages = run.data?.stageRuns ?? [];
  const blocked = useMemo(() => stages.filter((s) => needsAttention(s.status)), [stages]);
  // Only an in-flight run is still accruing time; anything else is measured
  // to its last update.
  const elapsed = run.data
    ? runElapsed(run.data, isActive(run.data.status) ? null : run.data.updatedAt)
    : null;

  if (run.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={5} />
      </View>
    );
  }
  if (run.error) return <ErrorState message={String(run.error)} onRetry={() => void run.refetch()} />;
  if (!run.data) return <ErrorState title="Run not found" />;

  const workspaceId = run.data.workspaceId;

  return (
    <PlainScroll
      onRefresh={() => {
        void run.refetch();
        void interrupts.refetch();
      }}
      refreshing={run.isFetching}
    >
      <Card className="gap-2.5 p-4">
        <View className="flex-row items-center gap-2">
          <StatusDot tone={toneOf(run.data.status)} />
          <Text className="flex-1 text-lg font-semibold text-foreground">
            {run.data.name ?? `Run ${runId.slice(0, 8)}`}
          </Text>
          {isActive(run.data.status) ? <Spinner /> : null}
          <Badge label={statusLabel(run.data.status)} tone={toneOf(run.data.status)} />
        </View>
        <Text className="text-xs text-muted-foreground">
          Started {relativeTime(run.data.startedAt ?? run.data.createdAt)}
          {elapsed != null ? ` · ${formatDuration(elapsed)}` : ''}
        </Text>
        {run.data.error ? (
          <View className="rounded-2xl border border-danger bg-danger-muted p-3">
            <Text className="text-sm text-foreground">{run.data.error}</Text>
          </View>
        ) : null}
      </Card>

      {blocked.length > 0 ? (
        <>
          <SectionHeader title="Waiting for you" />
          {blocked.map((stage) => (
            <StageGate
              key={stage.id}
              stage={stage}
              prompt={interrupts.data?.find((i) => i.stageId === stage.stageDefinitionId)?.prompt}
              busy={busyStage === stage.stageDefinitionId}
              onDecide={(outcome) => decide(stage.stageDefinitionId, outcome)}
            />
          ))}
        </>
      ) : null}

      <SectionHeader title={`Stages (${stages.length})`} />
      {stages.length === 0 ? (
        <EmptyState title="No stages yet" message="Stages appear as the run reaches them." />
      ) : (
        <View className="gap-2">
          {stages.map((stage, index) => (
            <StageRow key={stage.id} stage={stage} index={index} last={index === stages.length - 1} />
          ))}
        </View>
      )}

      {workspaceId ? (
        <>
          <SectionHeader title="Workspace" />
          <ListGroup>
            <ListRow
              title="Changes"
              subtitle="Files this run created or edited"
              icon={<FileDiff size={18} color={colors.primary} />}
              onPress={() => router.push(`/changes/${workspaceId}`)}
            />
            {terminalGate.available ? (
              <ListRow
                title="Terminal"
                subtitle="Run commands in this workspace"
                icon={<TerminalSquare size={18} color={colors['muted-foreground']} />}
                onPress={() => router.push(`/terminal/${workspaceId}`)}
              />
            ) : null}
          </ListGroup>
        </>
      ) : null}

      <View className="mt-2 flex-row gap-2.5 rounded-3xl border border-border bg-subtle p-3.5">
        <Info size={16} color={colors['muted-foreground']} />
        <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">
          {runControl.reason}
        </Text>
      </View>
    </PlainScroll>
  );
}

/**
 * One stage, drawn as a timeline entry.
 *
 * The connector between rows is what makes the sequence readable at a glance;
 * without it a phone-width list of pills reads as an unordered set.
 */
function StageRow({
  stage,
  index,
  last,
}: {
  stage: StageRunSummary;
  index: number;
  last: boolean;
}): React.ReactElement {
  const elapsed = runElapsed(stage, isActive(stage.status) ? null : stage.completedAt);
  const tone = toneOf(stage.status);

  return (
    <View className="flex-row gap-3">
      <View className="items-center pt-4">
        <StatusDot tone={tone} ring />
        {!last ? <View className="mt-1 w-px flex-1 bg-border-muted" /> : null}
      </View>

      <Card className="mb-1 flex-1 gap-1 p-3.5">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="flex-1 text-sm font-medium text-foreground">
            {stage.name ?? stage.stageDefinitionId}
          </Text>
          {isActive(stage.status) ? <Spinner /> : null}
          <Badge label={statusLabel(stage.status)} tone={tone} />
        </View>
        <Text numberOfLines={2} className="text-xs text-muted-foreground">
          {`${index + 1}. `}
          {elapsed != null ? formatDuration(elapsed) : 'not started'}
          {stage.retryCount ? ` · retry ${stage.retryCount}` : ''}
        </Text>
        {stage.error ? (
          <Text numberOfLines={3} className="text-xs text-danger">
            {stage.error}
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

/**
 * The approval gate.
 *
 * Three outcomes, matching the server's contract exactly. Targets are full
 * width and stacked because this is the one control on the screen a person
 * must be able to hit correctly on the first try, one-handed.
 */
function StageGate({
  stage,
  prompt,
  busy,
  onDecide,
}: {
  stage: StageRunSummary;
  prompt?: string | undefined;
  busy: boolean;
  onDecide: (outcome: Outcome) => void;
}): React.ReactElement {
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      className="gap-3 rounded-3xl border border-warning bg-warning-muted p-4"
    >
      <Text className="text-md font-semibold text-foreground">
        {stage.name ?? stage.stageDefinitionId}
      </Text>
      {prompt ? (
        <Text className="text-sm leading-relaxed text-muted-foreground">{prompt}</Text>
      ) : null}

      <View className="gap-2">
        <Button label="Approve" full size="lg" disabled={busy} onPress={() => onDecide('approved')} />
        <Button
          label="Request changes"
          full
          variant="secondary"
          disabled={busy}
          onPress={() => onDecide('changes_requested')}
        />
        <Button
          label="Reject"
          full
          variant="danger"
          disabled={busy}
          onPress={() => onDecide('rejected')}
        />
      </View>
    </Animated.View>
  );
}

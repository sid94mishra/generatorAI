// ────────────────────────────────────────────────────────────────
// WorkflowRunRows — what a chat's workflow tools produced, as transcript
// rows under the call (P06 WP-6.2; the web's WorkflowRunCards).
//
//   ▸ run row      under `run_workflow`: status, stage progress, the run
//                  page; once finalized, the summary and the pull request.
//                  A decision the run is parked on shows inside it: a
//                  completion review is answered here (Approve / Request
//                  changes / Reject, the run page's `approve` command), any
//                  other decision opens the run page.
//   ▸ draft row    under `create_workflow_draft`: open the workflow, or
//                  publish it (a person publishes an agent's draft, PD-14).
//
// The run's live state is the chat's run list (`chats.workflowRuns`, which
// the chat stream patches from `chat.workflow_run.*` — `useChatStream`), so
// it survives a reload; the tool result is only the fallback.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, FileJson2, GitPullRequest, Hand, MessageSquare, Upload, Workflow, X } from 'lucide-react-native';
import {
  decisionLabel,
  isTerminalRunStatus,
  mergeWorkflowRunCards,
  queryKeys,
  type WorkflowDraftToolCard,
  type WorkflowRunCardView,
  type WorkflowRunPendingApproval,
  type WorkflowRunToolCard,
} from '@generatorai/client-core';

import { Badge, type Tone } from '../../ui/primitives';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Form';
import { useToast } from '../../ui/Toast';
import { haptics } from '../../ui/haptics';
import { useTheme } from '../../../theme/ThemeProvider';
import { useAdminApi } from '../../../api/useAdminApi';
import { useApi } from '../../../api/useApi';
import { RowFrame, type RowTone } from './RowFrame';
import { useTimelineActions } from './TimelineActions';

const STATUS_LABEL: Record<string, string> = {
  created: 'Created',
  starting: 'Starting',
  running: 'Running',
  paused: 'Paused',
  waiting: 'Waiting',
  finalizing: 'Finalizing',
  cancelling: 'Cancelling',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function statusTone(status: string): Tone {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'paused' || status === 'waiting') return 'warning';
  if (status === 'cancelled') return 'neutral';
  return 'info';
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'That did not work';
}

type CardsData = { runs: WorkflowRunCardView[] };

/** The chat's run cards, merged over what the stream already folded in. */
function useChatWorkflowRuns(chatId: string | null | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.chatWorkflowRuns(chatId ?? ''),
    queryFn: async (): Promise<CardsData> => {
      const { runs } = await api.chats.workflowRuns(chatId!);
      const prior = queryClient.getQueryData<CardsData>(queryKeys.chatWorkflowRuns(chatId!));
      return { runs: mergeWorkflowRunCards(runs, prior?.runs) };
    },
    enabled: !!chatId,
    staleTime: 10_000,
    refetchInterval: (query) =>
      query.state.data?.runs.some((r) => !isTerminalRunStatus(r.status)) ? 15_000 : false,
  });
}

// ── Run row ──────────────────────────────────────────────────────

export function WorkflowRunRow({ run, callId }: { run: WorkflowRunToolCard; callId: string }): React.ReactElement {
  const { colors } = useTheme();
  const { chatId } = useTimelineActions();
  const { data } = useChatWorkflowRuns(chatId);
  const live = data?.runs.find((r) => r.runId === run.runId) ?? data?.runs.find((r) => r.toolCallId === callId);
  const pending = live && !isTerminalRunStatus(live.status) ? live.pendingApprovals : [];
  // A decision addressed to the user opens the row.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? pending.length > 0;

  const name = live?.workflowName ?? run.workflowName ?? 'Workflow run';
  const status = live?.status ?? run.status ?? 'starting';
  const terminal = isTerminalRunStatus(status);
  const total = live?.stagesTotal ?? 0;
  const progress =
    total > 0
      ? `${live?.stagesDone ?? 0}/${total} stages${live?.currentStage && !terminal ? ` · ${live.currentStage}` : ''}`
      : null;
  const tone: RowTone = pending.length > 0 ? 'warning' : status === 'failed' ? 'danger' : 'info';

  return (
    <RowFrame
      card
      icon={<Workflow size={16} color={status === 'failed' ? colors.danger : colors.primary} />}
      title={name}
      detail={pending.length > 0 ? `${pending.length} decision${pending.length === 1 ? '' : 's'} waiting for you` : progress}
      right={<Badge label={STATUS_LABEL[status] ?? status} tone={statusTone(status)} />}
      tone={tone}
      expanded={open}
      onToggle={() => setExpanded(!open)}
      accessibilityLabel={`Workflow run ${name}, ${STATUS_LABEL[status] ?? status}`}
    >
      <View className="gap-2 px-3 py-2.5">
        {progress && pending.length > 0 ? <Text className="text-xs text-muted-foreground">{progress}</Text> : null}
        {terminal && live?.summary ? (
          <Text numberOfLines={6} className="text-xs text-muted-foreground">
            {live.summary}
          </Text>
        ) : null}
        {pending.map((approval) => (
          <ApprovalBlock key={approval.instanceId} runId={run.runId} approval={approval} chatId={chatId ?? null} />
        ))}
        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Open run"
            size="sm"
            variant="secondary"
            icon={<ExternalLink size={14} color={colors.foreground} />}
            onPress={() => router.push(`/runs/${run.runId}` as never)}
          />
          {live?.prUrl ? (
            <Button
              label="Pull request"
              size="sm"
              variant="secondary"
              icon={<GitPullRequest size={14} color={colors.foreground} />}
              accessibilityLabel="Open the pull request in the browser"
              onPress={() => void Linking.openURL(live.prUrl!)}
            />
          ) : null}
        </View>
      </View>
    </RowFrame>
  );
}

// ── Approval ─────────────────────────────────────────────────────

function ApprovalBlock({
  runId,
  approval,
  chatId,
}: {
  runId: string;
  approval: WorkflowRunPendingApproval;
  chatId: string | null;
}): React.ReactElement {
  const { colors } = useTheme();
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const review = approval.decision === 'stage_completion_review';

  const answer = useMutation({
    mutationFn: (outcome: 'approved' | 'rejected' | 'changes_requested') =>
      api.runs.command(runId, {
        command: 'approve',
        instanceId: approval.instanceId,
        outcome,
        ...(outcome !== 'approved' && feedback.trim() ? { feedback: feedback.trim() } : {}),
      }),
    onSuccess: (_data, outcome) => {
      if (outcome === 'approved') haptics.success();
      else haptics.commit();
      setFeedbackOpen(false);
      setFeedback('');
      if (!chatId) return;
      const key = queryKeys.chatWorkflowRuns(chatId);
      // Answered: drop it now; the refetch confirms.
      queryClient.setQueryData<CardsData>(key, (old) =>
        old
          ? {
              runs: old.runs.map((r) =>
                r.runId === runId
                  ? { ...r, pendingApprovals: r.pendingApprovals.filter((p) => p.instanceId !== approval.instanceId) }
                  : r,
              ),
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => {
      haptics.error();
      toast({ message: errorText(err), variant: 'danger' });
    },
  });

  return (
    <View className="gap-2 rounded-xl border border-border-muted bg-raised px-3 py-2.5">
      <View className="flex-row items-center gap-2">
        <Hand size={14} color={colors.warning} />
        <Text numberOfLines={2} className="flex-1 text-sm text-foreground">
          {decisionLabel(approval.decision)} · {approval.stageName}
        </Text>
      </View>
      {approval.answerableByAgent ? (
        <Text className="text-xs text-muted-foreground">The agent that started this run may answer it too.</Text>
      ) : null}
      {review ? (
        <>
          {feedbackOpen ? (
            <Field
              value={feedback}
              onChangeText={setFeedback}
              placeholder="What should change?"
              multiline
              autoFocus
            />
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            {feedbackOpen ? (
              <>
                <Button
                  label="Send"
                  size="sm"
                  loading={answer.isPending}
                  disabled={!feedback.trim()}
                  onPress={() => answer.mutate('changes_requested')}
                />
                <Button label="Cancel" size="sm" variant="ghost" onPress={() => setFeedbackOpen(false)} />
              </>
            ) : (
              <>
                <Button
                  label="Approve"
                  size="sm"
                  loading={answer.isPending && answer.variables === 'approved'}
                  disabled={answer.isPending}
                  icon={<Check size={14} color={colors['primary-foreground']} />}
                  onPress={() => answer.mutate('approved')}
                />
                <Button
                  label="Request changes"
                  size="sm"
                  variant="secondary"
                  disabled={answer.isPending}
                  icon={<MessageSquare size={14} color={colors.foreground} />}
                  onPress={() => setFeedbackOpen(true)}
                />
                <Button
                  label="Reject"
                  size="sm"
                  variant="ghost"
                  disabled={answer.isPending}
                  icon={<X size={14} color={colors.primary} />}
                  onPress={() => answer.mutate('rejected')}
                />
              </>
            )}
          </View>
        </>
      ) : (
        <Button
          label="Answer on the run page"
          size="sm"
          variant="secondary"
          icon={<ExternalLink size={14} color={colors.foreground} />}
          onPress={() => router.push(`/runs/${runId}` as never)}
        />
      )}
    </View>
  );
}

// ── Draft row ────────────────────────────────────────────────────

export function WorkflowDraftRow({ draft }: { draft: WorkflowDraftToolCard }): React.ReactElement {
  const { colors } = useTheme();
  const admin = useAdminApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [expanded, setExpanded] = useState(true);

  const record = useQuery({
    queryKey: ['workflow-definition', draft.workflowId],
    queryFn: () => admin.definitions.get(draft.workflowId),
    staleTime: 30_000,
    retry: false,
  });
  const publish = useMutation({
    mutationFn: () => admin.definitions.publish(draft.workflowId),
    onSuccess: (next) => {
      haptics.success();
      queryClient.setQueryData(['workflow-definition', draft.workflowId], next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows() });
      toast({ message: 'Published.', variant: 'success' });
    },
    onError: (err) => {
      haptics.error();
      toast({ message: errorText(err), variant: 'danger' });
    },
  });

  const published = record.data?.status === 'published';
  const name = record.data?.graph.workflow.name ?? draft.name;
  const warnings = draft.warnings.length;

  return (
    <RowFrame
      card
      icon={<FileJson2 size={16} color={colors.primary} />}
      title={name}
      detail={warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : 'Submitted for review'}
      right={<Badge label={published ? 'Published' : 'Agent draft'} tone={published ? 'success' : 'warning'} />}
      tone="info"
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      accessibilityLabel={`Workflow draft ${name}`}
    >
      <View className="gap-2 px-3 py-2.5">
        {draft.warnings.slice(0, 4).map((w, i) => (
          <Text key={i} numberOfLines={3} className="text-xs text-warning">
            {w}
          </Text>
        ))}
        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Open workflow"
            size="sm"
            variant="secondary"
            icon={<ExternalLink size={14} color={colors.foreground} />}
            onPress={() => router.push(`/workflows/${draft.workflowId}` as never)}
          />
          {!published && !record.isError ? (
            <Button
              label="Publish"
              size="sm"
              loading={publish.isPending}
              disabled={!record.data}
              icon={<Upload size={14} color={colors['primary-foreground']} />}
              onPress={() => publish.mutate()}
            />
          ) : null}
        </View>
      </View>
    </RowFrame>
  );
}

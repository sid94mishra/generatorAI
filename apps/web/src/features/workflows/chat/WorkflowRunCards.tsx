// ────────────────────────────────────────────────────────────────
// Chat workflow cards (WF-12 run · WF-13 approval · WF-14 draft) and the
// Tasks dock's "Workflow runs from this chat" section — what a chat's
// workflow tools produced, where the agent called them (P06 WP-6.2).
//
//   ▸ run card    under `run_workflow`: status, the stage running now,
//                 n of m stages, the run page link; once finalized, the
//                 summary and the pull request.
//   ▸ approval    a decision the run is parked on (GateCardFrame, tone warn).
//                 A completion review is answered here (Approve / Request
//                 changes / Reject — the run page's `approve` command); any
//                 other decision links to the run page, where its card lives.
//   ▸ draft card  under `create_workflow_draft`: its risk flags; open it in
//                 the builder (the agent-draft banner is there), or publish
//                 it after a confirmation that repeats the risks.
//
// The run card's live state is the chat's run list (`useChatWorkflowRuns`,
// folded live from `chat.workflow_run.*`), so it survives a reload; the
// tool result is only the fallback before the list has the run (and the
// whole story in a transcript with no chat, a stage's).
//
// Rendered only from data the API has (D-36): the board's run number, pinned
// version, run clock and review round are not on `ChatWorkflowRunCard`, so
// they are not drawn. The card carries no usage, so no cost either (D-81).
// Registered by app/registries/workflowTranscriptCards.tsx (segment cards)
// and app/registries/tasksSections.tsx (Tasks section).
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { riskFlags } from '@generatorai/workflow-spec';
import { DANGER, RISK_LABELS } from '@generatorai/shared/ui-contract';
import { resolveStatus, type StatusValue } from '@generatorai/shared';
import {
  appPath,
  decisionLabel,
  isTerminalRunStatus,
  type WorkflowDraftToolCard,
  type WorkflowRunCardView,
  type WorkflowRunPendingApproval,
  type WorkflowRunToolCard,
} from '@generatorai/client-core';
import { useChatWorkflowRuns, usePublishDefinition, useWorkflowDefinition } from '@/hooks/workflowQueries.js';
import { useAnswerChatRunApproval, type ChatRunApprovalOutcome } from '@/hooks/workflowChatCardQueries.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { ProgressBar, type ProgressTone } from '@/ui/primitives/ProgressBar/ProgressBar.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { ActivityRow } from '@/ui/patterns/ActivityRow/ActivityRow.js';
import { GateCardFrame, type GateAction } from '@/ui/patterns/GateCardFrame/GateCardFrame.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';


const CARD = 'flex flex-col rounded-card border border-line bg-raised text-ui';

function RunStatusBadge({ status }: { status: string }) {
  const resolved = resolveStatus('workflowRun', status as StatusValue<'workflowRun'>);
  return resolved ? <StatusBadge state={resolved.state} label={resolved.label} /> : <Badge>{status}</Badge>;
}

function progressTone(status: string): ProgressTone {
  if (status === 'failed') return 'err';
  if (status === 'cancelled') return 'neutral';
  return 'run';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ── Run card (WF-12) ─────────────────────────────────────────────

export interface WorkflowRunCardProps {
  run: WorkflowRunToolCard;
  callId: string;
  chatId?: string | undefined;
  className?: string;
}

export function WorkflowRunCard({ run, callId, chatId, className }: WorkflowRunCardProps) {
  const { data } = useChatWorkflowRuns(chatId);
  const live: WorkflowRunCardView | undefined =
    data?.runs.find((r) => r.runId === run.runId) ?? data?.runs.find((r) => r.toolCallId === callId);

  const name = live?.workflowName ?? run.workflowName ?? 'Workflow run';
  const status = live?.status ?? run.status ?? 'starting';
  const link = appPath(live?.link ?? run.link);
  const done = live?.stagesDone ?? 0;
  const total = live?.stagesTotal ?? 0;
  const terminal = isTerminalRunStatus(status);
  const pending = live?.pendingApprovals ?? [];
  const currentStage = !terminal ? live?.currentStage : undefined;

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="workflow-run-card" data-run-id={run.runId}>
      <div className={CARD}>
        <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
          <Icon concept="workflows" size={16} className="shrink-0 text-fg-3" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate font-medium text-fg" title={name}>
                {name}
              </span>
              <RunStatusBadge status={status} />
              {run.replayed ? <span className="shrink-0 text-small text-fg-3">(same run)</span> : null}
            </div>
            {total > 0 ? (
              <div className="flex min-w-0 items-center gap-2 text-small text-fg-3">
                {currentStage ? <span className="min-w-0 truncate text-fg-2">{currentStage}</span> : null}
                <ProgressBar
                  value={Math.min(done, total)}
                  max={total}
                  size="inline"
                  tone={progressTone(status)}
                  label={`${done} of ${total} stages done`}
                  className="shrink-0"
                />
                <span className="shrink-0 font-mono text-micro tabular-nums">
                  {done}/{total} stages
                </span>
              </div>
            ) : null}
          </div>
          {link ? (
            <Button
              size="sm"
              icon="external-link"
              className="shrink-0"
              render={<RouterLink to={link} />}
              data-testid="workflow-run-card-link"
            >
              Open run
            </Button>
          ) : null}
        </div>

        {terminal && (live?.summary || live?.prUrl) ? (
          <div className="flex flex-col gap-1.5 border-t border-line-soft px-3 py-2.5">
            {live.summary ? (
              <p className="line-clamp-4 text-small whitespace-pre-wrap text-fg-2">{live.summary}</p>
            ) : null}
            {live.prUrl ? (
              <Link variant="external" href={live.prUrl} className="self-start text-small" data-testid="workflow-run-card-pr">
                <Icon concept="pr" size={12} className="text-fg-3" />
                Pull request
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {!terminal
        ? pending.map((approval) => (
            <WorkflowApprovalCard
              key={approval.instanceId}
              runId={run.runId}
              workflowName={name}
              approval={approval}
              link={link}
              chatId={chatId}
            />
          ))
        : null}
    </div>
  );
}

// ── Approval card (WF-13, composes the WF-09 review layout) ─────

function WorkflowApprovalCard({
  runId,
  workflowName,
  approval,
  link,
  chatId,
}: {
  runId: string;
  workflowName: string;
  approval: WorkflowRunPendingApproval;
  link: string | undefined;
  chatId: string | undefined;
}) {
  const { answer: send, isPending } = useAnswerChatRunApproval(chatId);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const review = approval.decision === 'stage_completion_review';

  const answer = async (outcome: ChatRunApprovalOutcome) => {
    const ok = await send({ runId, instanceId: approval.instanceId, outcome, feedback });
    if (ok) {
      setFeedbackOpen(false);
      setFeedback('');
    }
  };

  let actions: GateAction[] = [];
  if (review && !feedbackOpen) {
    actions = [
      {
        label: 'Reject',
        variant: 'danger',
        disabled: isPending,
        onClick: () => void answer('rejected'),
        'data-testid': 'workflow-approval-reject',
      },
      {
        label: 'Request changes',
        disabled: isPending,
        onClick: () => setFeedbackOpen(true),
        'data-testid': 'workflow-approval-changes',
      },
      {
        label: 'Approve',
        variant: 'primary',
        disabled: isPending,
        onClick: () => void answer('approved'),
        'data-testid': 'workflow-approval-approve',
      },
    ];
  } else if (review) {
    actions = [
      { label: 'Cancel', variant: 'ghost', disabled: isPending, onClick: () => setFeedbackOpen(false) },
      {
        label: 'Send',
        variant: 'primary',
        disabled: isPending || !feedback.trim(),
        onClick: () => void answer('changes_requested'),
        'data-testid': 'workflow-approval-send-changes',
      },
    ];
  }

  return (
    <GateCardFrame
      tone="warn"
      icon="hand"
      title={`${decisionLabel(approval.decision)} · ${approval.stageName}`}
      meta={workflowName}
      explanation={review ? 'Approving here uses the same command as the run page.' : undefined}
      actions={actions}
      data-testid="workflow-approval-card"
    >
      {approval.answerableByAgent || (review && link) ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-small">
          {approval.answerableByAgent ? (
            <Badge title="This run delegated its completion reviews to the agent that started it.">agent may answer</Badge>
          ) : null}
          {review && link ? (
            <Link variant="muted" render={<RouterLink to={link} />}>
              View in run
            </Link>
          ) : null}
        </div>
      ) : null}
      {review && feedbackOpen ? (
        <Textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          placeholder="What should change? (sent to the stage)"
          aria-label="What should change? (sent to the stage)"
          data-testid="workflow-approval-feedback"
        />
      ) : null}
      {!review && link ? (
        <Link render={<RouterLink to={link} />} className="self-start text-small" data-testid="workflow-approval-open-run">
          Answer on the run page
          <Icon concept="external-link" size={12} className="text-fg-3" />
        </Link>
      ) : null}
    </GateCardFrame>
  );
}

// ── Draft card (WF-14) ───────────────────────────────────────────

export interface WorkflowDraftCardProps {
  draft: WorkflowDraftToolCard;
  className?: string;
}

export function WorkflowDraftCard({ draft, className }: WorkflowDraftCardProps) {
  const navigate = useNavigate();
  const { data: record, isError } = useWorkflowDefinition(draft.workflowId);
  const publish = usePublishDefinition();
  const confirmer = useConfirm();
  // A draft that replaces a workflow is published into it and deleted.
  const [publishedInto, setPublishedInto] = useState<string | null>(null);
  const builder = appPath(draft.reviewLink) ?? `/workflows/${draft.workflowId}/edit`;
  const published = record?.status === 'published' || publishedInto !== null;
  const name = record?.graph.workflow.name ?? draft.name;
  const risks = useMemo(() => (record ? riskFlags(record.graph) : []), [record]);
  const stageCount = record?.graph.stages.length;

  const handlePublish = async () => {
    if (!record) return;
    const replaces = record.authoredBy?.replacesWorkflowId;
    const ok = await confirmer.confirm({
      title: `Publish "${name}"?`,
      description:
        `An agent wrote this workflow; once published it can run. ` +
        (risks.length > 0 ? `A run may: ${risks.map((f) => RISK_LABELS[f] ?? f).join(', ')}. ` : 'It declares no risky effects. ') +
        (replaces ? 'It replaces an existing workflow, which is published with this graph; the draft is deleted. ' : '') +
        'Open it in the builder to review the stages first.',
      confirmLabel: 'Publish',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      const out = await publish.mutateAsync(draft.workflowId);
      if (out.id !== draft.workflowId) setPublishedInto(out.id);
    } catch {
      /* toasted by the global handler */
    }
  };

  const badge = publishedInto ? (
    <Badge tone="ok">Published</Badge>
  ) : isError ? (
    <Badge>Discarded</Badge>
  ) : published ? (
    <Badge tone="ok">Published</Badge>
  ) : (
    <Badge icon="edit">Agent draft</Badge>
  );
  const meta = [
    stageCount !== undefined ? plural(stageCount, 'stage') : null,
    record && !isError ? (published ? 'Published' : 'Not published') : null,
  ].filter(Boolean);

  return (
    <div className={cn(CARD, className)} data-testid="workflow-draft-card" data-workflow-id={draft.workflowId}>
      <div className="flex min-w-0 items-center gap-2 px-3 pt-2.5 pb-2">
        <Icon concept="workflows" size={16} className="shrink-0 text-fg-3" />
        <span className="min-w-0 truncate font-medium text-fg" title={name}>
          {name}
        </span>
        {badge}
        {meta.length > 0 ? <span className="min-w-0 truncate text-small text-fg-3">{meta.join(' · ')}</span> : null}
      </div>

      {risks.length > 0 && !publishedInto ? (
        <div
          role="group"
          aria-label="What a run may do"
          className="flex min-w-0 flex-wrap items-center gap-1.5 px-3 pb-2"
          data-testid="workflow-draft-risks"
        >
          <span className="text-small text-fg-3">Risk:</span>
          {risks.map((flag) => (
            <Badge key={flag} tone={DANGER.has(flag) ? 'err' : 'warn'}>
              {RISK_LABELS[flag] ?? flag}
            </Badge>
          ))}
        </div>
      ) : null}

      {draft.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 px-3 pb-2 text-small text-warn">
          {draft.warnings.slice(0, 4).map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <Icon concept="warning" size={12} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{w}</span>
            </li>
          ))}
          {draft.warnings.length > 4 ? <li className="text-fg-3">… and {draft.warnings.length - 4} more</li> : null}
        </ul>
      ) : null}

      {!isError || publishedInto ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2">
          {!published ? <span className="min-w-0 flex-1 truncate text-small text-fg-3">Publishing needs a person.</span> : null}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              icon="edit"
              onClick={() => navigate(publishedInto ? `/workflows/${publishedInto}/edit` : builder)}
              data-testid="workflow-draft-open"
            >
              {publishedInto ? 'Open the workflow' : 'Open in builder (agent draft)'}
            </Button>
            {!published ? (
              <Button
                size="sm"
                variant="primary"
                icon="upload"
                loading={publish.isPending}
                disabled={!record}
                onClick={() => void handlePublish()}
                data-testid="workflow-draft-publish"
              >
                Publish
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {confirmer.dialog}
    </div>
  );
}

// ── Tasks dock section ───────────────────────────────────────────

function runDetail(run: WorkflowRunCardView, statusLabel: string | undefined): string {
  const waiting = !isTerminalRunStatus(run.status) ? run.pendingApprovals.length : 0;
  const parts: string[] = [];
  if (waiting > 0) parts.push('Needs you', `${plural(waiting, 'decision')} waiting`);
  else if (statusLabel) parts.push(statusLabel);
  if (run.stagesTotal > 0) parts.push(`${run.stagesDone}/${run.stagesTotal} stages`);
  if (run.currentStage) parts.push(run.currentStage);
  return parts.join(' · ');
}

/**
 * Workflow runs the orchestrator started (`run_workflow`, P06 WP-6.2): the
 * same runs the transcript shows under each call, as one list. Registered as
 * the chat dock's "Workflow runs from this chat" Tasks section.
 */
export function ChatWorkflowRunsSection({ chatId, stacked }: { chatId: string; stacked: boolean }) {
  const navigate = useNavigate();
  const { data } = useChatWorkflowRuns(chatId);
  const runs = data?.runs ?? [];
  if (runs.length === 0) {
    return stacked ? null : (
      <EmptyState
        icon="workflows"
        title="No workflow runs"
        description="This chat has not started a workflow run."
        className="flex-1 px-6 py-8"
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-col" data-testid="bg-workflow-runs">
      {!stacked ? (
        <div className="shrink-0 px-3 pt-3 pb-2">
          <SectionHeader title="Workflow runs" level={3} hint={plural(runs.length, 'run')} />
        </div>
      ) : null}
      <div role="list" aria-label="Workflow runs">
        {runs.map((r) => {
          const link = appPath(r.link);
          const resolved = resolveStatus('workflowRun', r.status as StatusValue<'workflowRun'>);
          const needsYou = !isTerminalRunStatus(r.status) && r.pendingApprovals.length > 0;
          return (
            <ActivityRow
              key={r.runId}
              role="listitem"
              twoLine
              persistentActions
              status={needsYou ? 'needs_you' : (resolved?.state ?? 'queued')}
              title={r.workflowName}
              detail={runDetail(r, resolved?.label ?? r.status)}
              actions={
                link ? <IconButton icon="external-link" size="sm" label="Open run" onClick={() => navigate(link)} /> : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}

/** The Tasks section's count: the chat's workflow runs, undefined while loading. */
export function useChatWorkflowRunsCount({ chatId }: { chatId: string }): number | undefined {
  return useChatWorkflowRuns(chatId).data?.runs.length;
}

// ────────────────────────────────────────────────────────────────
// WorkflowRunCards — what a chat's workflow tools produced, in the
// transcript where the agent called them (P06 WP-6.2).
//
//   ▸ run card    under `run_workflow`: status, the stage running now,
//                 n of m stages, the run page link; once finalized, the
//                 summary and the pull request.
//   ▸ approval    a decision the run is parked on. A completion review is
//                 answered here (Approve / Request changes / Reject — the
//                 run page's `approve` command); any other decision links
//                 to the run page, where its full card lives.
//   ▸ draft card  under `create_workflow_draft`: its risk flags; open it in
//                 the builder (the agent-draft banner is there), or publish
//                 it after a confirmation that repeats the risks.
//
// The run card's live state is the chat's run list (`useChatWorkflowRuns`,
// folded live from `chat.workflow_run.*`), so it survives a reload; the
// tool result is only the fallback before the list has the run (and the
// whole story in a transcript with no chat, a stage's).
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ExternalLink, FileJson2, GitPullRequest, Hand, MessageSquare, ShieldAlert, Upload, Workflow, X } from 'lucide-react';
import { riskFlags } from '@generatorai/workflow-spec';
import {
  appPath,
  decisionLabel,
  isTerminalRunStatus,
  type WorkflowDraftToolCard,
  type WorkflowRunCardView,
  type WorkflowRunPendingApproval,
  type WorkflowRunToolCard,
} from '@generatorai/client-core';
import { Badge, Button, StatusBadge, Textarea, useConfirm } from '@/components/ui/index.js';
import { DANGER, RISK_LABELS } from '@/components/workflow/builder/AgentDraftBanner.js';
import {
  useChatWorkflowRuns,
  usePublishDefinition,
  useRunCommand,
  useWorkflowDefinition,
  workflowKeys,
} from '@/hooks/workflowQueries.js';
import { cn } from '@/lib/utils.js';

const CARD = 'rounded-md border border-border bg-card text-[12px]';

// ── Run card ─────────────────────────────────────────────────────

export function WorkflowRunCard({
  run,
  callId,
  chatId,
  className,
}: {
  run: WorkflowRunToolCard;
  callId: string;
  chatId?: string | undefined;
  className?: string;
}) {
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

  return (
    <div className={cn(CARD, className)} data-testid="workflow-run-card" data-run-id={run.runId}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <Workflow className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate font-medium text-foreground" title={name}>{name}</span>
        <StatusBadge status={status} />
        {run.replayed && <span className="text-[10px] text-muted-foreground">(same run)</span>}
        <span className="flex-1" />
        {link && (
          <Link
            to={link}
            className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary hover:underline"
            data-testid="workflow-run-card-link"
          >
            Open run
            <ExternalLink className="h-3 w-3 opacity-70" />
          </Link>
        )}
      </div>

      {total > 0 && (
        <div className="px-2.5 pb-2">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{done}/{total} stages</span>
            {live?.currentStage && !terminal && (
              <span className="min-w-0 truncate">
                · <span className="text-foreground">{live.currentStage}</span>
              </span>
            )}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className={cn(
                'h-full rounded-full transition-[width]',
                status === 'failed' ? 'bg-danger' : status === 'completed' ? 'bg-success' : 'bg-primary',
              )}
              style={{ width: `${Math.min(100, Math.round((done / total) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {terminal && (live?.summary || live?.prUrl) && (
        <div className="space-y-1 border-t border-border px-2.5 py-2">
          {live.summary && (
            <p className="line-clamp-4 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted-foreground">
              {live.summary}
            </p>
          )}
          {live.prUrl && (
            <a
              href={live.prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              data-testid="workflow-run-card-pr"
            >
              <GitPullRequest className="h-3 w-3" />
              Pull request
              <ExternalLink className="h-2.5 w-2.5 opacity-70" />
            </a>
          )}
        </div>
      )}

      {!terminal && pending.map((approval) => (
        <WorkflowApprovalCard
          key={approval.instanceId}
          runId={run.runId}
          approval={approval}
          link={link}
          chatId={chatId}
        />
      ))}
    </div>
  );
}

// ── Approval card ────────────────────────────────────────────────

function WorkflowApprovalCard({
  runId,
  approval,
  link,
  chatId,
}: {
  runId: string;
  approval: WorkflowRunPendingApproval;
  link: string | undefined;
  chatId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const command = useRunCommand();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const review = approval.decision === 'stage_completion_review';

  const answer = async (outcome: 'approved' | 'rejected' | 'changes_requested') => {
    try {
      await command.mutateAsync({
        runId,
        command: {
          command: 'approve',
          instanceId: approval.instanceId,
          outcome,
          ...(outcome !== 'approved' && feedback.trim() ? { feedback: feedback.trim() } : {}),
        },
      });
      setFeedbackOpen(false);
      setFeedback('');
      if (chatId) {
        // The decision is answered: drop it now, the refetch confirms.
        queryClient.setQueryData<{ runs: WorkflowRunCardView[] }>(workflowKeys.chatRuns(chatId), (old) =>
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
        void queryClient.invalidateQueries({ queryKey: workflowKeys.chatRuns(chatId) });
      }
    } catch {
      /* toasted by the mutation */
    }
  };

  return (
    <div
      className="space-y-2 border-t border-warning/30 bg-warning-muted/30 px-2.5 py-2"
      data-testid="workflow-approval-card"
    >
      <div className="flex items-center gap-2">
        <Hand className="h-3.5 w-3.5 shrink-0 text-warning" />
        <span className="min-w-0 truncate text-foreground">
          {decisionLabel(approval.decision)} · <span className="font-medium">{approval.stageName}</span>
        </span>
        {approval.answerableByAgent && (
          <Badge tone="neutral" size="sm" title="This run delegated its completion reviews to the agent that started it.">
            agent may answer
          </Badge>
        )}
      </div>

      {review ? (
        <>
          {feedbackOpen && (
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder="What should change? (sent to the stage)"
              className="text-xs"
              data-testid="workflow-approval-feedback"
            />
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {!feedbackOpen ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={command.isPending}
                  onClick={() => void answer('approved')}
                  leftIcon={<Check className="h-3.5 w-3.5" />}
                  data-testid="workflow-approval-approve"
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  disabled={command.isPending}
                  onClick={() => setFeedbackOpen(true)}
                  leftIcon={<MessageSquare className="h-3.5 w-3.5" />}
                  data-testid="workflow-approval-changes"
                >
                  Request changes
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={command.isPending}
                  onClick={() => void answer('rejected')}
                  leftIcon={<X className="h-3.5 w-3.5" />}
                  data-testid="workflow-approval-reject"
                >
                  Reject
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={command.isPending || !feedback.trim()}
                  onClick={() => void answer('changes_requested')}
                  data-testid="workflow-approval-send-changes"
                >
                  Send
                </Button>
                <Button size="sm" variant="ghost" disabled={command.isPending} onClick={() => setFeedbackOpen(false)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </>
      ) : link ? (
        <Link
          to={link}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          data-testid="workflow-approval-open-run"
        >
          Answer on the run page
          <ExternalLink className="h-3 w-3 opacity-70" />
        </Link>
      ) : null}
    </div>
  );
}

// ── Draft card ───────────────────────────────────────────────────

export function WorkflowDraftCard({ draft, className }: { draft: WorkflowDraftToolCard; className?: string }) {
  const navigate = useNavigate();
  const { data: record, isError } = useWorkflowDefinition(draft.workflowId);
  const publish = usePublishDefinition();
  const { confirm: askConfirm, dialog } = useConfirm();
  // A draft that replaces a workflow is published into it and deleted.
  const [publishedInto, setPublishedInto] = useState<string | null>(null);
  const builder = appPath(draft.reviewLink) ?? `/workflows/${draft.workflowId}/edit`;
  const published = record?.status === 'published' || publishedInto !== null;
  const name = record?.graph.workflow.name ?? draft.name;
  const risks = useMemo(() => (record ? riskFlags(record.graph) : []), [record]);

  const handlePublish = async () => {
    if (!record) return;
    const replaces = record.authoredBy?.replacesWorkflowId;
    const ok = await askConfirm({
      title: `Publish "${name}"?`,
      description:
        `An agent wrote this workflow; once published it can run. ` +
        (risks.length > 0 ? `A run may: ${risks.map((f) => RISK_LABELS[f] ?? f).join(', ')}. ` : 'It declares no risky effects. ') +
        (replaces ? 'It replaces an existing workflow, which is published with this graph; the draft is deleted. ' : '') +
        'Open it in the builder to review the stages first.',
      confirmLabel: 'Publish',
    });
    if (!ok) return;
    try {
      const out = await publish.mutateAsync(draft.workflowId);
      if (out.id !== draft.workflowId) setPublishedInto(out.id);
    } catch {
      /* toasted by the global handler */
    }
  };

  return (
    <div className={cn(CARD, className)} data-testid="workflow-draft-card" data-workflow-id={draft.workflowId}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <FileJson2 className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate font-medium text-foreground" title={name}>{name}</span>
        {publishedInto ? (
          <Badge tone="success" size="sm">published</Badge>
        ) : isError ? (
          <Badge tone="neutral" size="sm">discarded</Badge>
        ) : published ? (
          <Badge tone="success" size="sm">published</Badge>
        ) : (
          <Badge tone="warning" size="sm">agent draft</Badge>
        )}
      </div>

      {risks.length > 0 && !publishedInto && (
        <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2" data-testid="workflow-draft-risks">
          <ShieldAlert className="h-3 w-3 text-warning" aria-label="What a run may do" />
          {risks.map((flag) => (
            <Badge key={flag} tone={DANGER.has(flag) ? 'danger' : 'warning'} size="sm">
              {RISK_LABELS[flag] ?? flag}
            </Badge>
          ))}
        </div>
      )}

      {draft.warnings.length > 0 && (
        <ul className="space-y-0.5 px-2.5 pb-2 text-[11px] text-warning">
          {draft.warnings.slice(0, 4).map((w, i) => (
            <li key={i} className="flex items-start gap-1">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0">{w}</span>
            </li>
          ))}
          {draft.warnings.length > 4 && (
            <li className="text-muted-foreground">… and {draft.warnings.length - 4} more</li>
          )}
        </ul>
      )}

      {(!isError || publishedInto) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-2.5 py-2">
          <Button
            size="sm"
            onClick={() => navigate(publishedInto ? `/workflows/${publishedInto}/edit` : builder)}
            leftIcon={<Workflow className="h-3.5 w-3.5" />}
            data-testid="workflow-draft-open"
          >
            {publishedInto ? 'Open the workflow' : 'Open in builder (agent draft)'}
          </Button>
          {!published && (
            <Button
              size="sm"
              variant="primary"
              loading={publish.isPending}
              disabled={publish.isPending || !record}
              onClick={() => void handlePublish()}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
              data-testid="workflow-draft-publish"
            >
              Publish
            </Button>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}

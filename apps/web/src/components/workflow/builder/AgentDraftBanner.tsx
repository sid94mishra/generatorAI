// ────────────────────────────────────────────────────────────────
// AgentDraftBanner — the builder's notice on a definition an agent wrote
// (P06 WP-6.5; PD-14: an agent submits a draft, a person publishes it).
//
//   who wrote it   the chat (link), the workflow stage (run link), or the
//                  external agent (client name and channel);
//   what it may do the risk flags (`riskFlags(graph)`, the same list
//                  describe_workflow gives an agent);
//   what changed   against the workflow it proposes to replace, by stage key
//                  and edge;
//   the decision   Publish (the page's own publish: saves first) / Discard.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { riskFlags, type RiskFlag, type WorkflowDefinitionRecord, type WorkflowGraph } from '@generatorai/workflow-spec';
import { Badge, Button, useConfirm } from '@/components/ui/index.js';
import { useDeleteWorkflowDefinition, useWorkflowDefinition, useWorkflowRun } from '@/hooks/workflowQueries.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { diffWorkflowGraphs, isEmptyDiff } from '@/lib/workflowGraphDiff.js';

const RISK_LABELS: Record<RiskFlag, string> = {
  writes_files: 'Writes files',
  commits: 'Commits',
  pushes: 'Pushes',
  opens_pr: 'Opens a pull request',
  bypass_permissions: 'Bypasses permission prompts',
  runs_repo_code: "Runs the repository's code",
  starts_other_workflows: 'Starts other workflows',
  worktree_per_item: 'A worktree per item',
  plans_stages_at_run_time: 'An agent plans stages at run time',
};

const DANGER: ReadonlySet<RiskFlag> = new Set<RiskFlag>(['pushes', 'opens_pr', 'bypass_permissions']);

export interface AgentDraftBannerProps {
  record: WorkflowDefinitionRecord;
  /** The saved graph: what the agent submitted plus any saved edits. */
  graph: WorkflowGraph;
  onPublish: () => void;
  publishing: boolean;
}

export function AgentDraftBanner({ record, graph, onPublish, publishing }: AgentDraftBannerProps) {
  const author = record.authoredBy;
  const navigate = useNavigate();
  const { confirm: askConfirm, dialog } = useConfirm();
  const discard = useDeleteWorkflowDefinition();
  const replacesId = author?.replacesWorkflowId;
  const { data: replaced } = useWorkflowDefinition(replacesId);
  const { data: sourceRun } = useWorkflowRun(author?.kind === 'stage' ? author.runId : undefined);

  const risks = useMemo(() => riskFlags(graph), [graph]);
  const diff = useMemo(() => (replaced ? diffWorkflowGraphs(replaced.graph, graph) : null), [replaced, graph]);

  if (!author) return null;

  const draft = record.status === 'draft';
  const canPublish = draft || record.hasUnpublishedChanges;

  const handleDiscard = async () => {
    const ok = await askConfirm({
      title: 'Discard this draft?',
      description: `"${graph.workflow.name}" was written by an agent and never published. Discarding deletes it.`,
      confirmLabel: 'Discard',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await discard.mutateAsync(record.id);
      // Nothing left to save: leave without the unsaved-changes prompt.
      useWorkflowBuilderStore.setState({ isDirty: false });
      navigate('/workflows');
    } catch {
      /* toasted by the global handler */
    }
  };

  return (
    <div className="border-b border-info/30 bg-info-muted px-4 py-2 text-sm" data-testid="agent-draft-banner">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-info">
          <Bot className="h-4 w-4 shrink-0" />
          <span className="font-medium">Agent draft</span>
          <span className="text-foreground">
            <AuthorLine author={author} sourceDefinitionId={sourceRun?.workflowDefinitionId} />
          </span>
        </span>

        <span className="flex-1" />

        {canPublish && (
          <Button
            size="sm"
            variant="primary"
            loading={publishing}
            disabled={publishing || discard.isPending}
            onClick={onPublish}
            leftIcon={<Upload className="h-3.5 w-3.5" />}
            data-testid="agent-draft-publish"
          >
            Publish
          </Button>
        )}
        {draft && (
          <Button
            size="sm"
            variant="danger"
            loading={discard.isPending}
            disabled={publishing || discard.isPending}
            onClick={() => void handleDiscard()}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            data-testid="agent-draft-discard"
          >
            Discard
          </Button>
        )}
      </div>

      {risks.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="agent-draft-risks">
          <ShieldAlert className="h-3.5 w-3.5 text-warning" aria-label="What a run may do" />
          {risks.map((flag) => (
            <Badge key={flag} tone={DANGER.has(flag) ? 'danger' : 'warning'} size="sm">
              {RISK_LABELS[flag]}
            </Badge>
          ))}
        </div>
      )}

      {replacesId && (
        <div className="mt-1.5 text-xs text-muted-foreground" data-testid="agent-draft-diff">
          Proposes to replace{' '}
          <Link to={`/workflows/${replacesId}/edit`} className="text-primary hover:underline">
            {replaced?.graph.workflow.name ?? 'a workflow'}
          </Link>
          {diff && (isEmptyDiff(diff) ? (
            <span> · no changes to its stages, edges or settings.</span>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {diff.stagesAdded.length > 0 && <DiffLine label="Stages added" items={diff.stagesAdded} tone="text-success" />}
              {diff.stagesRemoved.length > 0 && <DiffLine label="Stages removed" items={diff.stagesRemoved} tone="text-danger" />}
              {diff.stagesChanged.length > 0 && <DiffLine label="Stages changed" items={diff.stagesChanged} tone="text-warning" />}
              {diff.edgesAdded.length > 0 && <DiffLine label="Edges added" items={diff.edgesAdded} tone="text-success" />}
              {diff.edgesRemoved.length > 0 && <DiffLine label="Edges removed" items={diff.edgesRemoved} tone="text-danger" />}
              {diff.settingsChanged && (
                <li>
                  <span className="text-warning">Workflow settings changed</span> (session, lifecycle or variables)
                </li>
              )}
            </ul>
          ))}
        </div>
      )}
      {dialog}
    </div>
  );
}

function DiffLine({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  return (
    <li className="min-w-0">
      <span className={tone}>{label}</span>
      {': '}
      <span className="font-mono text-foreground">{items.join(', ')}</span>
    </li>
  );
}

function AuthorLine({
  author,
  sourceDefinitionId,
}: {
  author: NonNullable<WorkflowDefinitionRecord['authoredBy']>;
  sourceDefinitionId: string | undefined;
}) {
  const when = new Date(author.at);
  const at = Number.isNaN(when.getTime()) ? '' : ` · ${when.toLocaleString()}`;
  switch (author.kind) {
    case 'chat':
    case 'orchestrator':
      return (
        <>
          by {author.kind === 'orchestrator' ? 'an orchestrator chat' : 'a chat'}
          {author.chatId && (
            <>
              {' '}
              <Link to={`/chats/${author.chatId}`} className="text-primary hover:underline" data-testid="agent-draft-author-link">
                open chat
              </Link>
            </>
          )}
          {at}
        </>
      );
    case 'stage':
      return (
        <>
          by a workflow stage
          {author.runId && sourceDefinitionId && (
            <>
              {' '}
              <Link
                to={`/workflows/${sourceDefinitionId}/runs/${author.runId}`}
                className="text-primary hover:underline"
                data-testid="agent-draft-author-link"
              >
                open run
              </Link>
            </>
          )}
          {at}
        </>
      );
    case 'external_agent':
      return (
        <>
          by {author.clientName ?? 'an external agent'}
          {author.via ? ` (${author.via.toUpperCase()})` : ''}
          {at}
        </>
      );
    default:
      return <>by an agent{at}</>;
  }
}

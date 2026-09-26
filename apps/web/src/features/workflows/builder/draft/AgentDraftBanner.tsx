// ────────────────────────────────────────────────────────────────
// AgentDraftBanner — the card over the builder's canvas on a definition an
// agent wrote (P06 WP-6.5; PD-14: an agent submits a draft, a person
// publishes it; WorkflowAgentDraft board):
//
//   who wrote it   "Drafted by Orchestrator in a chat · open chat", a
//                  workflow stage (· open run) or an external agent (client
//                  name and channel) · "replaces <workflow> v7" · when
//   the decision   Review diff · Discard (a never-published draft; confirm)
//                  · Publish v8 (the page's own publish: saves first). A
//                  draft that replaces a workflow publishes INTO it, after a
//                  confirmation naming it.
//   what it may do the risk flags (`riskFlags(graph)`); pushes, PRs and
//                  bypassed permissions in the danger tone
//   what changed   "vs v7 +1 stage check_licenses · 1 changed run_tests";
//                  Review diff lists every added / removed / changed stage
//                  and edge, and changed settings
//
// `useDraftNodeTags` gives the canvas the same diff per node.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { DANGER, RISK_LABELS } from '@generatorai/shared/ui-contract';
import { riskFlags, type WorkflowDefinitionRecord, type WorkflowGraph } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import {
  useDefinitionVersions,
  useDeleteWorkflowDefinition,
  useWorkflowDefinition,
  useWorkflowRun,
} from '@/hooks/workflowQueries.js';
import { diffWorkflowGraphs, isEmptyDiff, type WorkflowGraphDiff } from '@/lib/workflowGraphDiff.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { KeyChip } from '@/blocks/workflow/chips/WorkflowChips.js';

export type DraftNodeTag = 'added' | 'changed';

/** The canvas marks of a draft's diff: "Added" / "Changed" per stage key (removed stages are not on the canvas). */
export function draftNodeTags(diff: WorkflowGraphDiff): Record<string, DraftNodeTag> {
  const tags: Record<string, DraftNodeTag> = {};
  for (const key of diff.stagesChanged) tags[key] = 'changed';
  for (const key of diff.stagesAdded) tags[key] = 'added';
  return tags;
}

/** The replaced workflow's diff, when `record` is an agent draft replacing one (else undefined). */
function useReplacedDiff(record: WorkflowDefinitionRecord | undefined, graph: WorkflowGraph | undefined) {
  const replacesId = record?.authoredBy?.replacesWorkflowId;
  const { data: replaced } = useWorkflowDefinition(replacesId);
  const diff = useMemo(() => (replaced && graph ? diffWorkflowGraphs(replaced.graph, graph) : undefined), [replaced, graph]);
  return { replacesId, replaced, diff };
}

/**
 * Node tags of an agent draft against the workflow it replaces; undefined
 * when `record` is not such a draft or the replaced workflow is not loaded.
 */
export function useDraftNodeTags(record: WorkflowDefinitionRecord | undefined): Record<string, DraftNodeTag> | undefined {
  const { diff } = useReplacedDiff(record?.authoredBy ? record : undefined, record?.graph);
  return useMemo(() => (diff ? draftNodeTags(diff) : undefined), [diff]);
}

export interface AgentDraftBannerProps {
  record: WorkflowDefinitionRecord;
  /** The saved graph: what the agent submitted plus any saved edits. */
  graph: WorkflowGraph;
  onPublish: () => void;
  publishing: boolean;
}

function when(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `today ${time}` : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

function maxVersion(versions: readonly { version: number }[] | undefined): number | undefined {
  return versions && versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : undefined;
}

/** A handful of stage keys, the rest as "+N". */
function Keys({ keys, max = 3 }: { keys: readonly string[]; max?: number }) {
  return (
    <>
      {keys.slice(0, max).map((k) => (
        <KeyChip key={k} stageKey={k} outlined />
      ))}
      {keys.length > max ? <span className="text-fg-3">+{keys.length - max}</span> : null}
    </>
  );
}

export function AgentDraftBanner({ record, graph, onPublish, publishing }: AgentDraftBannerProps) {
  const author = record.authoredBy;
  const navigate = useNavigate();
  const confirmer = useConfirm();
  const discard = useDeleteWorkflowDefinition();
  const { replacesId, replaced, diff } = useReplacedDiff(record, graph);
  const { data: sourceRun } = useWorkflowRun(author?.kind === 'stage' ? author.runId : undefined);
  const { data: replacedVersions } = useDefinitionVersions(replacesId);
  const { data: ownVersions } = useDefinitionVersions(record.id);
  const [reviewing, setReviewing] = useState(false);
  const risks = useMemo(() => riskFlags(graph), [graph]);

  if (!author) return null;

  const draft = record.status === 'draft';
  const canPublish = draft || record.hasUnpublishedChanges;
  const replacedName = replaced?.graph.workflow.name ?? 'the workflow it replaces';
  const replacedLive = replaced?.currentVersionId ? replacedVersions?.find((v) => v.id === replaced.currentVersionId)?.version : undefined;
  // A replacing draft publishes into the replaced workflow: its next version.
  const lastVersion = replacesId && draft ? maxVersion(replacedVersions) : maxVersion(ownVersions);
  const nextVersion = lastVersion !== undefined ? lastVersion + 1 : draft && !replacesId ? 1 : undefined;
  const changed = diff && !isEmptyDiff(diff);

  const handlePublish = async () => {
    if (replacesId && draft) {
      const ok = await confirmer.confirm({
        title: `Publish into "${replacedName}"?`,
        description: "This draft's graph replaces that workflow's and is published there; the draft is then deleted.",
        confirmLabel: 'Publish',
        tone: 'primary',
      });
      if (!ok) return;
    }
    onPublish();
  };

  const handleDiscard = async () => {
    const ok = await confirmer.confirm({
      title: 'Discard this draft?',
      description: `"${graph.workflow.name}" was written by an agent and never published. Discarding deletes it.`,
      confirmLabel: 'Discard',
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

  let byline: ReactNode;
  switch (author.kind) {
    case 'chat':
    case 'orchestrator':
      byline = (
        <>
          Drafted by <span className="font-medium text-fg">{author.kind === 'orchestrator' ? 'Orchestrator' : 'an agent'}</span> in a chat
          {author.chatId ? (
            <>
              {' '}
              <Link render={<RouterLink to={`/chats/${author.chatId}`} />} className="underline" data-testid="agent-draft-author-link">
                open chat
              </Link>
            </>
          ) : null}
        </>
      );
      break;
    case 'stage':
      byline = (
        <>
          Drafted by <span className="font-medium text-fg">a workflow stage</span>
          {author.runId && sourceRun?.workflowDefinitionId ? (
            <>
              {' '}
              <Link render={<RouterLink to={`/workflows/${sourceRun.workflowDefinitionId}/runs/${author.runId}`} />} className="underline" data-testid="agent-draft-author-link">
                open run
              </Link>
            </>
          ) : null}
        </>
      );
      break;
    case 'external_agent':
      byline = (
        <>
          Drafted by <span className="font-medium text-fg">{author.clientName ?? 'an external agent'}</span>
          {author.via ? ` (${author.via.toUpperCase()})` : ''}
        </>
      );
      break;
    default:
      byline = (
        <>
          Drafted by <span className="font-medium text-fg">an agent</span>
        </>
      );
  }
  const at = when(author.at);

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-raised px-3 py-2.5 shadow-pop" data-testid="agent-draft-banner">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-ui text-fg-2">
          <Icon concept="agents" size={14} className="text-fg-3" />
          <span>{byline}</span>
          {replacesId ? (
            <span>
              · replaces{' '}
              <Link render={<RouterLink to={`/workflows/${replacesId}/edit`} />} className="underline">
                {replaced?.graph.workflow.name ?? 'a workflow'}
              </Link>
              {replacedLive != null ? <span className="font-mono text-fg"> v{replacedLive}</span> : null}
            </span>
          ) : null}
          {at ? <span className="font-mono text-micro text-fg-3">{at}</span> : null}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {changed ? (
            <Button size="sm" variant="ghost" icon="diff" pressed={reviewing} onClick={() => setReviewing((r) => !r)} aria-expanded={reviewing}>
              Review diff
            </Button>
          ) : null}
          {draft ? (
            <Button
              size="sm"
              variant="danger"
              loading={discard.isPending}
              disabled={publishing || discard.isPending}
              onClick={() => void handleDiscard()}
              data-testid="agent-draft-discard"
            >
              Discard
            </Button>
          ) : null}
          {canPublish ? (
            <Button
              size="sm"
              variant="primary"
              icon="upload"
              loading={publishing}
              disabled={publishing || discard.isPending}
              onClick={() => void handlePublish()}
              data-testid="agent-draft-publish"
            >
              Publish{nextVersion !== undefined ? <>{' '}<span className="font-mono">v{nextVersion}</span></> : null}
            </Button>
          ) : null}
        </div>
      </div>

      {risks.length > 0 || replacesId ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-small">
          {risks.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="agent-draft-risks">
              <span className="text-fg-3">Risk</span>
              {risks.map((flag) => (
                <Badge key={flag} tone={DANGER.has(flag) ? 'err' : 'warn'} icon={DANGER.has(flag) ? 'shield' : 'warning'}>
                  {RISK_LABELS[flag]}
                </Badge>
              ))}
            </div>
          ) : null}
          {replacesId && diff ? (
            <div className="flex flex-wrap items-center gap-1.5 text-fg-3" data-testid="agent-draft-diff">
              <span>vs {replacedLive != null ? <span className="font-mono">v{replacedLive}</span> : replacedName}</span>
              {isEmptyDiff(diff) ? <span>no changes to its stages, edges or settings</span> : null}
              {diff.stagesAdded.length > 0 ? (
                <>
                  <span className="font-mono text-ok">
                    +{diff.stagesAdded.length} {diff.stagesAdded.length === 1 ? 'stage' : 'stages'}
                  </span>
                  <Keys keys={diff.stagesAdded} />
                </>
              ) : null}
              {diff.stagesRemoved.length > 0 ? (
                <>
                  <span className="font-mono text-err">−{diff.stagesRemoved.length} removed</span>
                  <Keys keys={diff.stagesRemoved} />
                </>
              ) : null}
              {diff.stagesChanged.length > 0 ? (
                <>
                  <span className="font-mono text-warn">{diff.stagesChanged.length} changed</span>
                  <Keys keys={diff.stagesChanged} />
                </>
              ) : null}
              {diff.edgesAdded.length + diff.edgesRemoved.length > 0 ? (
                <span className="font-mono">
                  {diff.edgesAdded.length > 0 ? <span className="text-ok">+{diff.edgesAdded.length}</span> : null}
                  {diff.edgesAdded.length > 0 && diff.edgesRemoved.length > 0 ? ' ' : null}
                  {diff.edgesRemoved.length > 0 ? <span className="text-err">−{diff.edgesRemoved.length}</span> : null}{' '}
                  {diff.edgesAdded.length + diff.edgesRemoved.length === 1 ? 'edge' : 'edges'}
                </span>
              ) : null}
              {diff.settingsChanged ? <span className="text-warn">settings changed</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {reviewing && diff && changed ? (
        <ul className="flex flex-col gap-1 border-t border-line-soft pt-2 text-small" data-testid="agent-draft-diff-detail">
          <DiffLine label="Stages added" items={diff.stagesAdded} tone="text-ok" />
          <DiffLine label="Stages removed" items={diff.stagesRemoved} tone="text-err" />
          <DiffLine label="Stages changed" items={diff.stagesChanged} tone="text-warn" />
          <DiffLine label="Edges added" items={diff.edgesAdded} tone="text-ok" />
          <DiffLine label="Edges removed" items={diff.edgesRemoved} tone="text-err" />
          {diff.settingsChanged ? (
            <li>
              <span className="text-warn">Workflow settings changed</span>
              <span className="text-fg-3"> (session, lifecycle or variables)</span>
            </li>
          ) : null}
        </ul>
      ) : null}
      {confirmer.dialog}
    </div>
  );
}

function DiffLine({ label, items, tone }: { label: string; items: readonly string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <li className="min-w-0 break-words">
      <span className={tone}>{label}</span>
      <span className="text-fg-3">: </span>
      <span className="font-mono text-fg">{items.join(', ')}</span>
    </li>
  );
}

// ────────────────────────────────────────────────────────────────
// F-dock-07 PlanPanel — the dock's Plan tab (ChatPlan board; PLN-01).
//
// The full plan document: path + status, revision switcher (older revisions
// are read-only with a stale banner), rendered content, inline review
// comments anchored to selected text, edit with an optimistic revision (409 →
// "Plan changed while you were editing"), save a tracked copy to the
// workspace, and the decision footer (Discard · +N comments · Request changes
// · Approve, Ctrl+Enter). Revisions and anchored comments are the existing API.
//
// A block (D-04): the chat dock mounts it, and a workflow stage plan may too.
// Toasts only for errors (D-30); successes show in the panel itself.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { resolveStatus, type PlanAction } from '@generatorai/shared';
import {
  useAddPlanComment,
  useDecidePlan,
  usePlan,
  usePlans,
  useSavePlanToWorkspace,
  useUpdatePlanContent,
} from '@/hooks/queries.js';
import { Avatar } from '@/ui/primitives/Avatar/Avatar.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { cn } from '@/ui/lib/cn.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';

export interface PlanPanelProps {
  chatId: string;
  /** Plan to show. Falls back to the plan awaiting review, else the newest. */
  planId?: string | null;
}

/** Hashes the quoted text so an anchor survives later revisions. */
async function hashText(text: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  } catch {
    return '';
  }
}

function clock(value: Date | string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface Selection {
  text: string;
  startLine: number;
  endLine: number;
}

/** Locates the selected text in the markdown source to derive a line range. */
function selectionIn(content: string): Selection | null {
  const text = window.getSelection()?.toString().trim();
  if (!text) return null;
  const lines = content.split('\n');
  const firstLine = text.split('\n')[0] ?? '';
  const startLine = Math.max(
    0,
    lines.findIndex((l) => firstLine.length > 0 && l.includes(firstLine)),
  );
  return { text, startLine, endLine: startLine + text.split('\n').length - 1 };
}

export function PlanPanel({ chatId, planId }: PlanPanelProps) {
  const { data: plans } = usePlans(chatId);
  const effectivePlanId =
    planId ?? plans?.find((p) => p.status === 'awaiting_review')?.planId ?? plans?.[0]?.planId ?? null;
  const { data: plan, isLoading } = usePlan(chatId, effectivePlanId ?? undefined);

  const [viewRevision, setViewRevision] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const decide = useDecidePlan(chatId);
  const updateContent = useUpdatePlanContent(chatId);
  const addComment = useAddPlanComment(chatId);
  const saveToWorkspace = useSavePlanToWorkspace(chatId);

  const revision = useMemo(() => {
    if (!plan) return null;
    const target = viewRevision ?? plan.currentRevision;
    return plan.revisions.find((r) => r.revision === target) ?? null;
  }, [plan, viewRevision]);

  // Reset transient UI when the plan changes underneath us.
  useEffect(() => {
    setViewRevision(null);
    setEditing(false);
    setSelection(null);
    setSavedPath(null);
  }, [effectivePlanId]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <Spinner size={16} label="Loading the plan" />
      </div>
    );
  }

  if (!plan || !revision) {
    return (
      <EmptyState
        icon="plan"
        title="No plan yet"
        description="Switch the composer to Plan mode and describe what you want. The agent researches and proposes a plan here for your approval."
        className="h-full bg-surface px-6"
      />
    );
  }

  const isActionable = plan.status === 'awaiting_review';
  const isStale = viewRevision !== null && viewRevision !== plan.currentRevision;
  const openComments = plan.comments.filter((c) => !c.resolved);
  const status = resolveStatus('plan', plan.status);
  const canDecide = isActionable && !editing && !isStale;

  const handleAddComment = async () => {
    if (!commentDraft.trim()) return;
    const anchor = selection
      ? {
          startLine: selection.startLine,
          endLine: selection.endLine,
          quotedText: selection.text,
          contentHash: await hashText(selection.text),
        }
      : undefined;
    try {
      await addComment.mutateAsync({
        planId: plan.id,
        body: commentDraft.trim(),
        revision: revision.revision,
        ...(anchor ? { anchor } : {}),
      });
      setCommentDraft('');
      setSelection(null);
    } catch {
      toast.error('Comment not saved');
    }
  };

  const handleSaveEdit = async () => {
    try {
      await updateContent.mutateAsync({
        planId: plan.id,
        content: draft,
        summary: plan.title,
        expectedRevision: plan.currentRevision,
      });
      setEditing(false);
    } catch {
      // The server answers 409 when another tab (or the agent) revised it.
      toast.error('Plan changed while you were editing', {
        description: 'Reload the plan and re-apply your edits.',
      });
    }
  };

  const handleDecision = async (approved: boolean, action?: PlanAction) => {
    try {
      await decide.mutateAsync({
        planId: plan.id,
        approved,
        ...(action ? { action } : {}),
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
        expectedRevision: plan.currentRevision,
      });
      setFeedback('');
    } catch {
      toast.error('Decision not recorded', { description: 'It may already have been resolved elsewhere.' });
    }
  };

  const handleSave = () => {
    void saveToWorkspace
      .mutateAsync(plan.id)
      .then((r) => (r.ok ? setSavedPath(r.path ?? plan.fileName) : toast.error('Could not save the plan')))
      .catch(() => toast.error('Could not save the plan'));
  };

  const onPanelKeyDown = (event: KeyboardEvent) => {
    if (!canDecide || decide.isPending) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleDecision(true, 'implement_interactive');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" onKeyDown={onPanelKeyDown}>
      <div className="flex shrink-0 flex-col gap-2 border-b border-line-soft px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-mono text-small text-fg-2" title={plan.filePath ?? plan.fileName}>
            plans/{plan.fileName}
          </span>
          {status ? <StatusBadge state={status.state} label={status.label} /> : null}
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {!editing ? (
              <IconButton
                icon="edit"
                size="sm"
                label="Edit plan"
                onClick={() => {
                  setDraft(revision.content);
                  setEditing(true);
                }}
              />
            ) : null}
            <IconButton icon="save" size="sm" label="Save plan to workspace" onClick={handleSave} />
          </div>
        </div>
        {plan.revisions.length > 1 ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-small font-medium text-fg">
              Revision {revision.revision} of {plan.currentRevision}
            </span>
            <SegmentedControl
              label="Plan revision"
              value={String(revision.revision)}
              onValueChange={(v) => {
                const n = Number(v);
                setViewRevision(n === plan.currentRevision ? null : n);
                setEditing(false);
              }}
              items={plan.revisions.map((r) => ({ value: String(r.revision), label: `v${r.revision}` }))}
            />
            <span className="ml-auto shrink-0 font-mono text-small text-fg-3">
              {revision.authoredBy === 'user' ? 'You' : 'Agent'} · {clock(revision.createdAt)}
            </span>
          </div>
        ) : null}
        {isStale ? (
          <Callout tone="warn">
            Viewing an older revision. Switch to v{plan.currentRevision} to edit or decide.
          </Callout>
        ) : null}
        {savedPath ? (
          <p className="text-small text-fg-3" role="status">
            Saved to <span className="font-mono">{savedPath}</span>
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <div className="flex h-full flex-col gap-2 p-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Edit plan document"
              spellCheck={false}
              className="min-h-0 flex-1"
              textareaClassName="font-mono text-small"
            />
            <div className="flex items-center justify-end gap-1.5">
              <Button size="sm" variant="ghost" icon="x" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" icon="save" loading={updateContent.isPending} onClick={() => void handleSaveEdit()}>
                Save as v{plan.currentRevision + 1}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-heading text-fg">{plan.title}</h3>
              {revision.summary && revision.summary !== plan.title ? (
                <p className="text-body text-fg-2">{revision.summary}</p>
              ) : null}
            </div>
            <div onMouseUp={() => setSelection(selectionIn(revision.content))} data-testid="plan-document">
              <Markdown>{revision.content}</Markdown>
            </div>

            {selection ? (
              <div className="flex flex-col gap-2 rounded-card border border-line bg-raised p-3" data-testid="plan-comment-draft">
                <p className="line-clamp-3 border-l-2 border-line-strong pl-2 text-small text-fg-2 italic">{selection.text}</p>
                <Textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  autoFocus
                  aria-label="Comment on the selected text"
                  placeholder="What should change here?"
                />
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelection(null);
                      setCommentDraft('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon="message"
                    disabled={!commentDraft.trim()}
                    loading={addComment.isPending}
                    onClick={() => void handleAddComment()}
                  >
                    Comment
                  </Button>
                </div>
              </div>
            ) : null}

            {plan.comments.length > 0 ? (
              <section className="flex flex-col gap-2 border-t border-line-soft pt-3" aria-label="Review comments">
                <SectionHeader variant="label" title="Review comments" count={`${openComments.length} open`} className="px-0" />
                {plan.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className={cn('flex flex-col gap-1 rounded-card border border-line-soft bg-raised p-2.5', comment.resolved && 'opacity-60')}
                  >
                    <div className="flex items-center gap-1.5 text-small text-fg-3">
                      <Avatar name="You" size={18} decorative />
                      <span className="font-medium text-fg">You</span>
                      <span className="font-mono">
                        {clock(comment.createdAt)} · v{comment.revision}
                      </span>
                      {comment.resolved ? <span className="ml-auto">Resolved</span> : null}
                    </div>
                    {comment.anchor ? (
                      <p className="line-clamp-2 border-l-2 border-line pl-2 text-small text-fg-3 italic">{comment.anchor.quotedText}</p>
                    ) : null}
                    <p className="text-ui break-words text-fg">{comment.body}</p>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        )}
      </div>

      {canDecide ? (
        <div className="flex shrink-0 flex-col gap-2 border-t border-line-soft p-3" data-testid="plan-decision">
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            aria-label="Notes for the agent"
            placeholder={
              openComments.length > 0
                ? `Notes for the agent (optional) — ${openComments.length} inline comment${openComments.length === 1 ? '' : 's'} included`
                : 'Notes for the agent (optional)'
            }
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Discard plan"
              title="Exit plan mode without implementing"
              disabled={decide.isPending}
              onClick={() => void handleDecision(true, 'exit_only')}
            >
              Discard plan
            </Button>
            {openComments.length > 0 ? (
              <span className="text-small text-fg-3">
                +{openComments.length} comment{openComments.length === 1 ? '' : 's'}
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" disabled={decide.isPending} onClick={() => void handleDecision(false)}>
                Request changes
              </Button>
              <Button
                size="sm"
                variant="primary"
                shortcut={['Ctrl', '↵']}
                loading={decide.isPending}
                onClick={() => void handleDecision(true, 'implement_interactive')}
              >
                Approve &amp; implement
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

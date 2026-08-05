// ────────────────────────────────────────────────────────────────
// PlanDocumentPanel — the right-pane "Plan" tab (PLN-01)
//
// The full plan document: render, edit, revision history, inline review
// comments, and the decision footer. This is where a user actually reviews a
// plan; the in-transcript PlanCard is the fast path.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Save,
  X,
  History,
  Download,
  CircleSlash,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';
import {
  usePlan,
  usePlans,
  useDecidePlan,
  useUpdatePlanContent,
  useAddPlanComment,
  useSavePlanToWorkspace,
} from '@/hooks/queries.js';
import { toast } from '@/components/Toast.js';
import type { PlanAction } from '@generatorai/shared';

export interface PlanDocumentPanelProps {
  chatId: string;
  /** Plan to show. Falls back to the most recent plan in the chat. */
  planId?: string | null;
}

/** Hashes the quoted text so an anchor survives later revisions. */
async function hashText(text: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  } catch {
    return '';
  }
}

export function PlanDocumentPanel({ chatId, planId }: PlanDocumentPanelProps) {
  const { data: plans } = usePlans(chatId);
  // Prefer a plan that is actually waiting on the user; otherwise the newest.
  const effectivePlanId =
    planId ?? plans?.find((p) => p.status === 'awaiting_review')?.planId ?? plans?.[0]?.planId ?? null;
  const { data: plan, isLoading } = usePlan(chatId, effectivePlanId ?? undefined);

  const [viewRevision, setViewRevision] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [selection, setSelection] = useState<{ text: string; startLine: number; endLine: number } | null>(null);

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
  }, [effectivePlanId]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (!plan || !revision) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <FileText className="h-8 w-8 text-[var(--color-muted-foreground)]/50" />
        <p className="text-sm font-medium text-[var(--color-foreground)]">No plan yet</p>
        <p className="max-w-xs text-xs text-[var(--color-muted-foreground)]">
          Switch the composer to <span className="font-medium">Plan</span> mode and describe what
          you want. The agent will research and propose a plan here for your approval.
        </p>
      </div>
    );
  }

  const isActionable = plan.status === 'awaiting_review';
  const isStale = viewRevision !== null && viewRevision !== plan.currentRevision;
  const openComments = plan.comments.filter((c) => !c.resolved);

  const handleCaptureSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }
    // Derive a line range by locating the quoted text in the source markdown.
    const lines = revision.content.split('\n');
    const firstLine = text.split('\n')[0] ?? '';
    const startLine = Math.max(
      0,
      lines.findIndex((l) => firstLine.length > 0 && l.includes(firstLine)),
    );
    const endLine = startLine + text.split('\n').length - 1;
    setSelection({ text, startLine, endLine });
  };

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
    await addComment.mutateAsync({
      planId: plan.id,
      body: commentDraft.trim(),
      revision: revision.revision,
      ...(anchor ? { anchor } : {}),
    });
    setCommentDraft('');
    setSelection(null);
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
      toast({ variant: 'success', title: 'Plan updated' });
    } catch {
      // The server returns 409 when another tab (or the agent) revised it.
      toast({
        variant: 'error',
        title: 'Plan changed while you were editing',
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
      toast({
        variant: 'success',
        title: approved
          ? action === 'exit_only'
            ? 'Plan discarded'
            : 'Plan approved'
          : 'Feedback sent',
        description: approved
          ? action === 'exit_only'
            ? 'The agent will not implement it.'
            : 'The agent is implementing it now.'
          : 'The agent is revising the plan.',
      });
    } catch {
      toast({
        variant: 'error',
        title: 'Decision not recorded',
        description: 'It may already have been resolved elsewhere.',
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-[var(--color-border)] px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--color-foreground)]">
              {plan.title}
            </h3>
            <p className="truncate font-mono text-[10px] text-[var(--color-muted-foreground)]">
              {plan.fileName}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {!editing && (
              <button
                type="button"
                onClick={() => {
                  setDraft(revision.content);
                  setEditing(true);
                }}
                title="Edit plan"
                aria-label="Edit plan"
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void saveToWorkspace
                  .mutateAsync(plan.id)
                  .then((r) =>
                    r.ok
                      ? toast({ variant: 'success', title: 'Saved to workspace', description: r.path ?? undefined })
                      : toast({ variant: 'error', title: 'Could not save the plan' }),
                  )
                  .catch(() => toast({ variant: 'error', title: 'Could not save the plan' }));
              }}
              title="Save a tracked copy into the workspace"
              aria-label="Save plan to workspace"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Revision switcher */}
        {plan.revisions.length > 1 && (
          <div className="mt-2 flex items-center gap-1.5">
            <History className="h-3 w-3 flex-shrink-0 text-[var(--color-muted-foreground)]" />
            <div className="flex flex-wrap gap-1">
              {plan.revisions.map((r) => (
                <button
                  key={r.revision}
                  type="button"
                  onClick={() => setViewRevision(r.revision)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                    r.revision === revision.revision
                      ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]',
                  )}
                  title={`${r.authoredBy === 'user' ? 'Your edit' : 'Agent revision'} · ${new Date(r.createdAt).toLocaleString()}`}
                >
                  v{r.revision}
                  {r.authoredBy === 'user' ? ' ✎' : ''}
                </button>
              ))}
            </div>
          </div>
        )}
        {isStale && (
          <p className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400">
            Viewing an older revision. Switch to v{plan.currentRevision} to edit or decide.
          </p>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <div className="flex h-full flex-col p-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-0 flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 font-mono text-xs leading-relaxed text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)]"
              spellCheck={false}
            />
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)]"
              >
                <X className="h-3 w-3" />
                Cancel
              </button>
              <button
                type="button"
                disabled={updateContent.isPending}
                onClick={() => void handleSaveEdit()}
                className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {updateContent.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                Save as v{plan.currentRevision + 1}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3">
            <div
              onMouseUp={handleCaptureSelection}
              className="min-w-0 text-[13px] leading-relaxed message-assistant"
            >
              <MarkdownRenderer content={revision.content} />
            </div>

            {/* Selection → comment */}
            {selection && (
              <div className="mt-3 rounded-lg border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/[0.04] p-2.5">
                <p className="mb-1.5 line-clamp-3 border-l-2 border-[var(--color-primary)]/50 pl-2 text-[11px] italic text-[var(--color-muted-foreground)]">
                  {selection.text}
                </p>
                <textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  rows={2}
                  autoFocus
                  placeholder="What should change here?"
                  className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-xs text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)]"
                />
                <div className="mt-1.5 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelection(null);
                      setCommentDraft('');
                    }}
                    className="rounded-md px-2 py-1 text-[11px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!commentDraft.trim() || addComment.isPending}
                    onClick={() => void handleAddComment()}
                    className="flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2 py-1 text-[11px] font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
                  >
                    <MessageSquarePlus className="h-3 w-3" />
                    Comment
                  </button>
                </div>
              </div>
            )}

            {/* Existing comments */}
            {plan.comments.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-[var(--color-border)]/60 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  Review comments ({openComments.length} open)
                </p>
                {plan.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className={cn(
                      'rounded-lg border p-2',
                      comment.resolved
                        ? 'border-[var(--color-border)]/40 opacity-60'
                        : 'border-[var(--color-border)]/70',
                    )}
                  >
                    {comment.anchor && (
                      <p className="mb-1 line-clamp-2 border-l-2 border-[var(--color-border)] pl-2 text-[10px] italic text-[var(--color-muted-foreground)]">
                        {comment.anchor.quotedText}
                      </p>
                    )}
                    <p className="text-xs text-[var(--color-foreground)]">{comment.body}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                      v{comment.revision}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Decision footer */}
      {isActionable && !editing && !isStale && (
        <div className="flex-shrink-0 space-y-2 border-t border-[var(--color-border)] p-3">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder={
              openComments.length > 0
                ? `Additional notes (${openComments.length} inline comment${openComments.length === 1 ? '' : 's'} will be included)`
                : 'Optional notes for the agent'
            }
            className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-xs text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)]"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => void handleDecision(true, 'implement_interactive')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-2 text-xs font-medium text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {decide.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Approve &amp; implement
            </button>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => void handleDecision(false)}
              className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)] disabled:opacity-50"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Request changes
            </button>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => void handleDecision(true, 'exit_only')}
              title="Exit plan mode without implementing"
              aria-label="Discard plan"
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50"
            >
              <CircleSlash className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// ReviewThreadCard — an inline comment thread rendered in the diff
// ────────────────────────────────────────────────────────────────
//
// Rendered through @pierre/diffs' `renderAnnotation`, so it appears directly
// beneath the anchored line inside the diff's shadow root.
//
// Collapsed by default, GitHub-style: a thread is a marker on the code first
// and a conversation second. Expanding every thread inline would push the
// diff apart until the code it is about is off screen — which defeats the
// point of anchoring it there. The collapsed row shows who said what in one
// line; clicking it opens the full thread with replies and editing.

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  MessageSquare,
  Pencil,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button, Spinner, Textarea } from '@/components/ui/index.js';
import type { ReviewIntent, ReviewThread, ReviewThreadStatus } from '@/types/review.js';

const STATUS_LABEL: Record<ReviewThreadStatus, { text: string; className: string }> = {
  draft: { text: 'Draft', className: 'bg-muted text-muted-foreground' },
  pending: { text: 'Pending', className: 'bg-amber-500/15 text-amber-500' },
  submitted: { text: 'Sent to agent', className: 'bg-sky-500/15 text-sky-500' },
  addressed: { text: 'Addressed', className: 'bg-emerald-500/15 text-emerald-500' },
  resolved: { text: 'Resolved', className: 'bg-emerald-500/15 text-emerald-500' },
  outdated: { text: 'Outdated', className: 'bg-muted text-muted-foreground' },
};

const INTENT_LABEL: Record<ReviewIntent, string> = {
  fix: 'Fix',
  question: 'Question',
  note: 'Note',
  refactor: 'Refactor',
  test: 'Test',
};

export interface ReviewThreadCardProps {
  thread: ReviewThread;
  /** Open on first render — used when jumping to a thread from the list. */
  defaultExpanded?: boolean;
  onReply?: (threadId: string, body: string) => void;
  onEdit?: (threadId: string, commentId: string, body: string) => void;
  onResolve?: (threadId: string) => void;
  onDelete?: (threadId: string) => void;
  onSend?: (threadId: string) => void;
  busy?: boolean;
}

export function ReviewThreadCard({
  thread,
  defaultExpanded = false,
  onReply,
  onEdit,
  onResolve,
  onDelete,
  onSend,
  busy,
}: ReviewThreadCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  /** Comment currently being rewritten, with its working copy. */
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const status = STATUS_LABEL[thread.status];
  const isClosed = thread.status === 'resolved' || thread.status === 'outdated';
  const first = thread.comments[0];
  const replies = Math.max(0, thread.comments.length - 1);
  const lineLabel =
    thread.startLine === thread.endLine
      ? `L${thread.startLine}`
      : `L${thread.startLine}–${thread.endLine}`;

  const commitEdit = () => {
    if (!editing || !onEdit) return;
    const next = editing.body.trim();
    if (next) onEdit(thread.id, editing.id, next);
    setEditing(null);
  };

  return (
    <div
      className={cn(
        'my-1 overflow-hidden rounded-md border bg-popover text-popover-foreground text-xs shadow-sm',
        isClosed && 'opacity-70',
      )}
    >
      {/* ── Summary row (always visible) ─────────────────────── */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="h-auto w-full items-center justify-start gap-1.5 rounded-none px-2 py-1.5 text-left font-normal hover:bg-accent/50"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {lineLabel}
        </span>
        {/* The one-line gist. Truncated on purpose: this row's job is to be
            recognisable, not complete — the full text is one click away. */}
        {!expanded && first && (
          <span className="min-w-0 flex-1 truncate text-[11px]">
            {first.intent && (
              <span className="mr-1 font-medium text-muted-foreground">
                {INTENT_LABEL[first.intent]}:
              </span>
            )}
            {first.body}
          </span>
        )}
        {!expanded && replies > 0 && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            +{replies} {replies === 1 ? 'reply' : 'replies'}
          </span>
        )}
        <span
          className={cn(
            'ml-auto shrink-0 rounded px-1 py-px text-[9px] font-medium',
            status.className,
          )}
        >
          {status.text}
        </span>
      </Button>

      {expanded && (
        <div className="border-t px-2 py-1.5">
          <div className="mb-1.5 flex items-center gap-1">
            {thread.reviewRound > 0 && (
              <span className="text-[9px] text-muted-foreground">
                round {thread.reviewRound}
              </span>
            )}
            <div className="ml-auto flex items-center gap-0.5">
              {onSend && (thread.status === 'pending' || thread.status === 'draft') && (
                <Button
                  type="button"
                  variant="ghost"
                  title="Send this comment to the agent"
                  onClick={() => onSend(thread.id)}
                  disabled={busy}
                  className="h-5 items-center gap-1 rounded border px-1.5 text-[10px] font-normal hover:bg-accent disabled:opacity-50"
                >
                  {busy ? (
                    <Spinner size="xs" />
                  ) : (
                    <Send className="h-2.5 w-2.5" />
                  )}
                  Send
                </Button>
              )}
              {onResolve && !isClosed && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Resolve"
                  aria-label="Resolve thread"
                  onClick={() => onResolve(thread.id)}
                  className="h-5 w-5 rounded hover:bg-accent"
                >
                  <Check className="h-3 w-3" />
                </Button>
              )}
              {onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Delete"
                  aria-label="Delete thread"
                  onClick={() => onDelete(thread.id)}
                  className="h-5 w-5 rounded hover:bg-accent hover:text-danger"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            {thread.comments.map((comment) => {
              const isEditing = editing?.id === comment.id;
              return (
                <div key={comment.id} className="group/comment flex gap-1.5">
                  <span
                    className={cn(
                      'mt-px h-4 shrink-0 rounded px-1 text-[9px] leading-4',
                      comment.author === 'agent'
                        ? 'bg-violet-500/15 text-violet-500'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {comment.author === 'agent' ? 'agent' : 'you'}
                  </span>
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex items-start gap-1">
                        <Textarea
                          ref={editRef}
                          value={editing.body}
                          onChange={(e) =>
                            setEditing({ id: comment.id, body: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              commitEdit();
                            }
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setEditing(null);
                            }
                          }}
                          rows={2}
                          aria-label="Edit comment"
                          className="min-w-0 flex-1 resize-none rounded border bg-transparent px-1.5 py-1 text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Save edit"
                          title="Save (⌘↵)"
                          onClick={commitEdit}
                          className="mt-0.5 h-5 w-5 rounded hover:bg-accent"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Cancel edit"
                          onClick={() => setEditing(null)}
                          className="mt-0.5 h-5 w-5 rounded hover:bg-accent"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        {comment.intent && (
                          <span className="mr-1 text-[10px] font-medium text-muted-foreground">
                            {INTENT_LABEL[comment.intent]}:
                          </span>
                        )}
                        <span className="whitespace-pre-wrap break-words">
                          {comment.body}
                        </span>
                        {/* Only the user's own words are editable — an agent
                            reply is a record of what was actually said. */}
                        {onEdit && comment.author === 'user' && !isClosed && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Edit comment"
                            title="Edit"
                            onClick={() =>
                              setEditing({ id: comment.id, body: comment.body })
                            }
                            className="ml-1 h-4 w-4 rounded align-text-bottom text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/comment:opacity-100"
                          >
                            <Pencil className="h-2.5 w-2.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {onReply && !isClosed && (
            <div className="mt-1.5">
              {replying ? (
                <div className="flex items-start gap-1">
                  <CornerDownRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        if (replyText.trim()) {
                          onReply(thread.id, replyText.trim());
                          setReplyText('');
                          setReplying(false);
                        }
                      }
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setReplyText('');
                        setReplying(false);
                      }
                    }}
                    rows={2}
                    autoFocus
                    placeholder="Reply… (⌘↵ to send)"
                    aria-label="Reply"
                    className="min-w-0 flex-1 resize-none rounded border bg-transparent px-1.5 py-1 text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Cancel reply"
                    onClick={() => {
                      setReplyText('');
                      setReplying(false);
                    }}
                    className="mt-0.5 h-5 w-5 rounded hover:bg-accent"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setReplying(true)}
                  className="h-auto w-auto rounded px-0 py-0 font-normal text-[10px] text-muted-foreground hover:bg-transparent hover:underline"
                >
                  Reply
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

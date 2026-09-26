// ────────────────────────────────────────────────────────────────
// ReviewThreadCard — an inline comment thread in the diff (B-07)
// ────────────────────────────────────────────────────────────────
//
// Rendered through @pierre/diffs' `renderAnnotation`, directly beneath the
// anchored line. Board: DockChanges "Review" (Y You L20 Fix Pending · Resolve ·
// trash · body · Reply… · Send).
//
// Collapsed by default, GitHub-style: a thread is a marker on the code first
// and a conversation second. Expanding every thread inline would push the diff
// apart until the code it is about is off screen. The collapsed row shows who
// said what in one line; its toggle — always the card's FIRST button — opens
// the full thread with replies and editing.

import { useEffect, useRef, useState } from 'react';
import { REVIEW_INTENT_LABELS, resolveStatus, reviewLineLabel } from '@generatorai/shared';
import { cn } from '@/ui/lib/cn.js';
import { Avatar } from '@/ui/primitives/Avatar/Avatar.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import type { ReviewAuthor, ReviewThread } from '@/types/review.js';
import { MOD_ENTER_TEXT, isModEnter } from './modEnter.js';

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

const AUTHOR_NAME: Record<ReviewAuthor, string> = { user: 'You', agent: 'Agent' };

function Author({ author }: { author: ReviewAuthor }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <Avatar name={AUTHOR_NAME[author]} size={18} decorative />
      <span className="font-medium text-fg">{AUTHOR_NAME[author]}</span>
    </span>
  );
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

  const status = resolveStatus('reviewThread', thread.status);
  const isClosed = thread.status === 'resolved' || thread.status === 'outdated';
  const sendable = thread.status === 'pending' || thread.status === 'draft';
  const first = thread.comments[0];
  const replies = Math.max(0, thread.comments.length - 1);

  const commitEdit = () => {
    if (!editing || !onEdit) return;
    const next = editing.body.trim();
    if (next) onEdit(thread.id, editing.id, next);
    setEditing(null);
  };

  const closeReply = () => {
    setReplyText('');
    setReplying(false);
  };

  const submitReply = () => {
    const body = replyText.trim();
    if (!body || !onReply) return;
    onReply(thread.id, body);
    closeReply();
  };

  return (
    <div
      // Closed threads sit on the flatter surface instead of fading: faded text fails contrast.
      className={cn('my-1 overflow-hidden rounded-card border border-line text-ui text-fg', isClosed ? 'bg-surface' : 'bg-raised')}
      data-thread-status={thread.status}
    >
      {/* ── Summary row (always visible; its toggle is the first button) ── */}
      <div className="flex items-center gap-0.5 pr-1.5">
        <Button
          variant="ghost"
          icon={expanded ? 'chevron-down' : 'chevron-right'}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 justify-start rounded-none font-normal text-fg-2 hover:not-disabled:text-fg-2"
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {first ? <Author author={first.author} /> : null}
            <span className="shrink-0 font-mono text-micro text-fg-3">
              {reviewLineLabel(thread.startLine, thread.endLine)}
            </span>
            {first?.intent ? <Badge>{REVIEW_INTENT_LABELS[first.intent]}</Badge> : null}
            {status ? <StatusBadge state={status.state} label={status.label} /> : null}
            {/* The one-line gist. Truncated on purpose: this row's job is to be
                recognisable, not complete — the full text is one click away. */}
            {!expanded && first ? <span className="min-w-0 truncate text-fg-2">{first.body}</span> : null}
            {!expanded && replies > 0 ? (
              <span className="shrink-0 text-small text-fg-3">
                +{replies} {replies === 1 ? 'reply' : 'replies'}
              </span>
            ) : null}
          </span>
        </Button>
        {expanded && onResolve && !isClosed ? (
          <Button
            variant="ghost"
            size="sm"
            icon="check"
            aria-label="Resolve thread"
            onClick={() => onResolve(thread.id)}
          >
            Resolve
          </Button>
        ) : null}
        {expanded && onDelete ? (
          <IconButton icon="trash" size="sm" label="Delete thread" onClick={() => onDelete(thread.id)} />
        ) : null}
      </div>

      {expanded ? (
        <div className="flex flex-col gap-2.5 px-3 pt-1 pb-2.5">
          {thread.reviewRound > 0 ? <span className="text-micro text-fg-3">Round {thread.reviewRound}</span> : null}

          <div className="flex flex-col gap-2">
            {thread.comments.map((comment, index) => {
              const isEditing = editing?.id === comment.id;
              return (
                <div key={comment.id} className="group flex min-w-0 flex-col gap-1">
                  {index > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-small">
                      <Author author={comment.author} />
                      {comment.intent ? <Badge>{REVIEW_INTENT_LABELS[comment.intent]}</Badge> : null}
                    </span>
                  ) : null}
                  {isEditing ? (
                    <div className="flex items-start gap-1">
                      <Textarea
                        ref={editRef}
                        value={editing.body}
                        onChange={(e) => setEditing({ id: comment.id, body: e.target.value })}
                        onKeyDown={(e) => {
                          if (isModEnter(e)) {
                            e.preventDefault();
                            commitEdit();
                          }
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            setEditing(null);
                          }
                        }}
                        autosize={{ minRows: 2, maxRows: 8 }}
                        aria-label="Edit comment"
                        className="min-w-0 flex-1"
                      />
                      <IconButton icon="check" size="sm" label="Save edit" tooltip={`Save (${MOD_ENTER_TEXT})`} onClick={commitEdit} />
                      <IconButton icon="x" size="sm" label="Cancel edit" onClick={() => setEditing(null)} />
                    </div>
                  ) : (
                    <p className="m-0 min-w-0 text-ui text-fg">
                      <span className="break-words whitespace-pre-wrap">{comment.body}</span>
                      {/* Only the user's own words are editable — an agent
                          reply is a record of what was actually said. */}
                      {onEdit && comment.author === 'user' && !isClosed ? (
                        <IconButton
                          icon="edit"
                          size="sm"
                          label="Edit comment"
                          onClick={() => setEditing({ id: comment.id, body: comment.body })}
                          className="ml-1 align-middle opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        />
                      ) : null}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {(onReply && !isClosed) || (onSend && sendable) ? (
            <div className="flex items-start gap-1.5">
              {onReply && !isClosed ? (
                replying ? (
                  <div className="flex min-w-0 flex-1 items-start gap-1">
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (isModEnter(e)) {
                          e.preventDefault();
                          submitReply();
                        }
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          closeReply();
                        }
                      }}
                      autosize={{ minRows: 2, maxRows: 8 }}
                      autoFocus
                      placeholder={`Reply… (${MOD_ENTER_TEXT} to send)`}
                      aria-label="Reply"
                      className="min-w-0 flex-1"
                    />
                    <IconButton icon="x" size="sm" label="Cancel reply" onClick={closeReply} />
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" icon="message" onClick={() => setReplying(true)}>
                    Reply
                  </Button>
                )
              ) : null}
              {onSend && sendable ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon="send"
                  loading={busy}
                  disabled={busy}
                  title="Send this comment to the agent"
                  onClick={() => onSend(thread.id)}
                  className="ml-auto"
                >
                  Send
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

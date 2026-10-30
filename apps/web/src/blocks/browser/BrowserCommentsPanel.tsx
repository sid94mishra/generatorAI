// ────────────────────────────────────────────────────────────────
// BrowserCommentsPanel (F-dock-04, D-145) — the page's comments, under it.
//
//   ┌ 💬 Comments 3 ··························· Attach all  [Send all ▶]  ✕ ┐
//   │ ┌ New comment · button#start.cta “Get startd” ──────────────────── ✕ ┐ │
//   │ │ [Fix] Question Refactor Test Note                                   │ │
//   │ │ ┌ What should the agent change here? ─────────────────────────────┐ │ │
//   │ │ [Add comment] [Add & send ▶]                          Esc to cancel │ │
//   │ ① Fix  Make the plans one row        div.plans      ✎  📎  ▶  🗑     │
//   │ ② Fix  The button should be blue     a#start.cta    ✎  📎  ▶  🗑     │
//   └──────────────────────────────────────────────────────────────────────┘
//
// A drawer in the dock's column, never over the page (an overlay above the
// WebContentsView hides it, D-19). The form is ReviewCommentForm — the same
// one the Changes review uses — for a new selection and for editing. Each
// comment can be attached to the message or sent on its own; or all at once.
// A row shows its element on the page.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { REVIEW_INTENT_LABELS, type ReviewIntent } from '@generatorai/shared';
import type { AnnotationSummary } from './browserAnnotations.js';
import { ReviewCommentForm } from '../diff/review/ReviewCommentForm.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Kbd } from '@/ui/primitives/Kbd/Kbd.js';

export interface BrowserCommentsPanelProps {
  items: readonly AnnotationSummary[];
  /** The element or area just selected, awaiting its comment. */
  pending: AnnotationSummary | null;
  selecting: boolean;
  sending: boolean;
  /** What the last send did ("Sent 3 comments to the agent"), shown briefly. */
  notice: string | null;
  /** Sending as a message now is possible (a chat). */
  canSend: boolean;
  /** Attaching to the composer is possible. */
  canAttach: boolean;
  onSave: (key: string, body: string, intent: ReviewIntent, sendNow: boolean) => void;
  onCancelPending: () => void;
  /** `keys` absent = all comments. */
  onSend: (keys?: string[]) => void;
  onAttach: (keys?: string[]) => void;
  onShow: (key: string) => void;
  onRemove: (key: string) => void;
  onClose: () => void;
}

const intentOf = (it: AnnotationSummary): ReviewIntent => (it.intent in REVIEW_INTENT_LABELS ? (it.intent as ReviewIntent) : 'fix');

function about(it: AnnotationSummary): React.JSX.Element {
  return (
    <>
      {it.label}
      {it.text ? <span className="font-sans"> · “{it.text.length > 48 ? `${it.text.slice(0, 48)}…` : it.text}”</span> : null}
    </>
  );
}

export function BrowserCommentsPanel({
  items, pending, selecting, sending, notice, canSend, canAttach,
  onSave, onCancelPending, onSend, onAttach, onShow, onRemove, onClose,
}: BrowserCommentsPanelProps): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  const count = items.length;

  return (
    <section aria-label="Browser comments" data-testid="browser-comments-panel" className="flex max-h-120 min-h-0 shrink-0 flex-col border-t border-line bg-surface">
      <header className="flex h-bar shrink-0 items-center gap-2 px-3">
        <Icon concept="message" size={14} className="text-fg-3" />
        <h3 className="text-ui font-semibold text-fg">Comments</h3>
        {count > 0 ? <span className="font-mono text-micro text-fg-3 tabular-nums">{count}</span> : null}
        {notice ? (
          <span role="status" className="flex min-w-0 items-center gap-1.5 truncate text-small text-ok" data-testid="browser-comment-notice">
            <Icon concept="check" size={12} className="shrink-0" />
            <span className="truncate">{notice}</span>
          </span>
        ) : null}
        <span className="flex-1" />
        {count > 0 && canAttach ? (
          <Button size="sm" icon="attach" onClick={() => onAttach()} disabled={sending} data-testid="browser-comments-attach-all">
            Attach all
          </Button>
        ) : null}
        {count > 0 && canSend ? (
          <Button variant="primary" size="sm" icon="send" loading={sending} onClick={() => onSend()} data-testid="browser-comments-send-all">
            Send all
          </Button>
        ) : null}
        <IconButton size="sm" icon="x" label="Close comments" onClick={onClose} />
      </header>

      <div className="flex min-h-0 flex-col overflow-y-auto border-t border-line-soft">
        {pending ? (
          <div className="border-b border-line-soft bg-raised" data-testid="browser-comment-composer">
            <ReviewCommentForm
              key={pending.key}
              label="Comment on the page"
              context={<>New comment · {about(pending)}</>}
              busy={sending}
              onCancel={onCancelPending}
              onSubmit={(body, intent) => onSave(pending.key, body, intent, false)}
              {...(canSend ? { onSubmitAndSend: (body: string, intent: ReviewIntent) => onSave(pending.key, body, intent, true) } : {})}
            />
          </div>
        ) : null}

        {count > 0 ? (
          <ol className="m-0 flex list-none flex-col p-1" data-testid="browser-comment-list">
            {items.map((it) =>
              editing === it.key ? (
                <li key={it.key} className="my-1 overflow-hidden rounded-card border border-line bg-raised">
                  <ReviewCommentForm
                    label={`Edit comment ${it.n}`}
                    context={<>Comment {it.n} · {about(it)}</>}
                    initialBody={it.comment}
                    initialIntent={intentOf(it)}
                    submitLabel="Update comment"
                    busy={sending}
                    onCancel={() => setEditing(null)}
                    onSubmit={(body, intent) => { onSave(it.key, body, intent, false); setEditing(null); }}
                    {...(canSend
                      ? { onSubmitAndSend: (body: string, intent: ReviewIntent) => { onSave(it.key, body, intent, true); setEditing(null); } }
                      : {})}
                  />
                </li>
              ) : (
                <li key={it.key} className="group flex items-start gap-2 rounded-control px-2 py-1.5 hover:bg-hover" data-testid="browser-comment-row">
                  <span
                    aria-hidden
                    className="mt-0.5 flex min-w-4.5 shrink-0 items-center justify-center rounded-badge bg-run-bg px-1 py-px font-mono text-micro font-semibold text-run tabular-nums"
                  >
                    {it.n}
                  </span>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onShow(it.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onShow(it.key);
                      }
                    }}
                    title="Show on the page"
                    aria-label={`Comment ${it.n}: ${it.comment}. Show on the page`}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-control-sm focus-ring"
                  >
                    <span className="flex min-w-0 items-start gap-1.5">
                      <Badge size="sm" className="mt-px shrink-0">{REVIEW_INTENT_LABELS[intentOf(it)]}</Badge>
                      <span className="line-clamp-2 text-ui text-fg">{it.comment}</span>
                    </span>
                    <span className="truncate font-mono text-micro text-fg-3">{about(it)}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton size="sm" icon="edit" label={`Edit comment ${it.n}`} onClick={() => setEditing(it.key)} />
                    {canAttach ? (
                      <IconButton size="sm" icon="attach" label={`Attach comment ${it.n} to the message`} onClick={() => onAttach([it.key])} disabled={sending} />
                    ) : null}
                    {canSend ? (
                      <IconButton size="sm" icon="send" label={`Send comment ${it.n} to the agent`} onClick={() => onSend([it.key])} disabled={sending} />
                    ) : null}
                    <IconButton size="sm" icon="trash" label={`Delete comment ${it.n}`} onClick={() => onRemove(it.key)} />
                  </div>
                </li>
              ),
            )}
          </ol>
        ) : null}

        {!pending && count === 0 ? (
          <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 py-3 text-small text-fg-3" data-testid="browser-comments-empty">
            {selecting ? (
              <>
                <Icon concept="pointer" size={12} className="text-run" />
                Hover the page and click an element — or drag across an area — to comment.
                <span className="inline-flex items-center gap-1"><Kbd keys="Esc" /> finishes</span>
              </>
            ) : (
              <>No comments yet. Turn on <Icon concept="pointer" size={12} /> Select element in the toolbar, then click anything on the page.</>
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}

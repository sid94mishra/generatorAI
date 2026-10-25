// ────────────────────────────────────────────────────────────────
// ReviewSendDialog — check the pending review comments, add a note, preview
// the exact message and send it, in a dialog (D-164). The Changes panel keeps
// only the one-line PendingCommentsBar, so the diff keeps its height.
//
// The batch is the point: a reviewer reads the whole diff, leaves several
// comments, then sends them as ONE instruction — the agent re-plans once.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { REVIEW_INTENT_LABELS, reviewLineLabel } from '@generatorai/shared';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Dialog, DialogBody, DialogClose, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import type { ReviewThread } from '@/types/review.js';

export interface ReviewSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The comments still to send (pending / draft). */
  threads: readonly ReviewThread[];
  /** Show a comment in the diff (closes the dialog). */
  onJump: (thread: ReviewThread) => void;
  onDelete: (threadId: string) => void;
  /** Undefined when there is nowhere to send (`disabledReason` says why). */
  onSend?: (note: string) => Promise<void> | void;
  /** Ask the server for the exact prompt; it arrives as `previewPrompt`. */
  onPreview?: (note: string) => Promise<void> | void;
  previewPrompt: string | null;
  onClosePreview: () => void;
  busy?: boolean;
  disabledReason?: string;
}

function displayPath(thread: ReviewThread): string {
  return thread.repoAlias === '.' ? thread.path : `${thread.repoAlias}/${thread.path}`;
}

export function ReviewSendDialog({
  open,
  onOpenChange,
  threads,
  onJump,
  onDelete,
  onSend,
  onPreview,
  previewPrompt,
  onClosePreview,
  busy = false,
  disabledReason,
}: ReviewSendDialogProps) {
  const [note, setNote] = useState('');
  // A preview describes one note and one set of comments: changing either makes it stale, and it hides.
  const inputsKey = `${note}\u0000${threads.map((t) => t.id).join(',')}`;
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewing = previewKey === inputsKey;

  const togglePreview = async () => {
    if (previewing) {
      setPreviewKey(null);
      onClosePreview();
      return;
    }
    setPreviewKey(inputsKey);
    setPreviewLoading(true);
    try {
      await onPreview?.(note);
    } finally {
      setPreviewLoading(false);
    }
  };

  const send = async () => {
    await onSend?.(note);
    setNote('');
    onOpenChange(false);
  };

  const count = threads.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Send review to the agent" data-testid="review-send-dialog">
      <DialogBody>
        <section aria-label="Comments" className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-fg">
            {count} {count === 1 ? 'comment' : 'comments'}
          </h3>
          {count === 0 ? (
            <p className="text-small text-fg-3">No comments waiting to be sent.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line-soft rounded-card border border-line">
              {threads.map((thread) => {
                const first = thread.comments[0];
                return (
                  <li key={thread.id} className="flex min-w-0 items-start gap-2 px-3 py-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate font-mono text-small text-fg" title={displayPath(thread)}>
                          {displayPath(thread)}
                        </span>
                        <span className="shrink-0 font-mono text-micro text-fg-3">{reviewLineLabel(thread.startLine, thread.endLine)}</span>
                        {first?.intent ? <Badge size="sm">{REVIEW_INTENT_LABELS[first.intent]}</Badge> : null}
                      </span>
                      <p className="text-ui whitespace-pre-wrap text-fg-2">{first?.body ?? 'No comment yet'}</p>
                      {thread.comments.length > 1 ? (
                        <span className="text-small text-fg-3">+{thread.comments.length - 1} more in the thread</span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <IconButton icon="view" size="sm" label={`Show ${displayPath(thread)} in the diff`} onClick={() => onJump(thread)} />
                      <IconButton icon="trash" size="sm" label="Delete this comment" onClick={() => onDelete(thread.id)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Field label="Note for the agent" optional hint="Sent after the comments, e.g. “run the tests when you are done”.">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autosize={{ minRows: 3, maxRows: 8 }}
            placeholder="An instruction that applies to the whole review"
            data-testid="review-note"
          />
        </Field>

        {onPreview ? (
          <section aria-label="Message preview" className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-ui font-semibold text-fg">Message</h3>
              <Button
                variant="ghost"
                size="sm"
                icon="view"
                pressed={previewing}
                disabled={count === 0}
                onClick={() => void togglePreview()}
                className="ml-auto"
                data-testid="review-preview-toggle"
              >
                {previewing ? 'Hide' : 'Preview'}
              </Button>
            </div>
            {previewing ? (
              previewLoading || previewPrompt === null ? (
                <p className="flex items-center gap-2 text-small text-fg-3">
                  <Spinner size={12} /> Building the message…
                </p>
              ) : (
                <pre
                  className="max-h-72 overflow-auto rounded-control border border-line-soft bg-sunken px-3 py-2 font-mono text-micro whitespace-pre-wrap text-fg-2"
                  data-testid="review-preview"
                >
                  {previewPrompt}
                </pre>
              )
            ) : (
              <p className="text-small text-fg-3">See exactly what the agent will receive before you send it.</p>
            )}
          </section>
        ) : null}
      </DialogBody>
      <DialogFooter hint={onSend ? 'All comments go as one message, so the agent plans once.' : disabledReason}>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          variant="primary"
          icon="send"
          loading={busy}
          disabled={!onSend || count === 0}
          title={disabledReason}
          onClick={() => void send()}
          data-testid="review-send"
        >
          Send {count === 1 ? 'comment' : `${count} comments`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

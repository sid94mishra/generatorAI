// ────────────────────────────────────────────────────────────────
// CommentsPopover — every comment on this diff, in one list
// (F-dock-01 ChangesPanel toolbar "Comments (count popover)").
// ────────────────────────────────────────────────────────────────
//
// Deliberately the same shape as the integrated browser's Comments popover
// (count on the toolbar → list → per-item send/delete → "Send N to chat").
// Reviewing a diff and reviewing a rendered page are the same task with
// different anchors, so they should not be two interfaces to learn.
//
// Threads also render inline under their line. This list answers what the
// inline cards cannot: "what have I got outstanding, across files I may have
// collapsed or scrolled past?"

import { reviewLineLabel } from '@generatorai/shared';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { popoverClamp } from '@/ui/lib/popup.js';
import type { ReviewThread } from '@/types/review.js';

export interface CommentsPopoverProps {
  threads: ReviewThread[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reveal the thread's file + line in the diff. */
  onJump: (thread: ReviewThread) => void;
  onSendOne?: (threadId: string) => void;
  onSendAll?: () => void;
  onDelete: (threadId: string) => void;
  busy?: boolean;
}

/** Only threads still waiting on the agent can be sent. */
function isSendable(t: ReviewThread): boolean {
  return t.status === 'pending' || t.status === 'draft';
}

export function CommentsPopover({
  threads,
  open,
  onOpenChange,
  onJump,
  onSendOne,
  onSendAll,
  onDelete,
  busy,
}: CommentsPopoverProps) {
  const total = threads.length;
  const sendable = threads.filter(isSendable);

  return (
    <PopoverRoot open={open} onOpenChange={(next) => onOpenChange(next)}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            icon="message"
            title="Comments — review every note and send them to the agent"
            aria-label={`Comments (${total})`}
            className={total > 0 ? 'text-fg' : undefined}
          >
            {total > 0 ? total : null}
          </Button>
        }
      />
      <PopoverPopup align="end" sideOffset={4} className={`w-80 ${popoverClamp}`}>
      <PopoverTitle className="m-0 flex h-control-lg items-center border-b border-line-soft px-3 text-ui font-semibold text-fg">
        Comments{total > 0 ? ` (${total})` : ''}
      </PopoverTitle>

      {total === 0 ? (
        <p className="m-0 px-3 py-4 text-center text-small text-fg-3">
          Select lines in the diff and press the <span className="font-mono">+</span> in the gutter to comment on them.
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto p-1">
          {threads.map((thread) => {
            const first = thread.comments[0];
            // Always alias-prefixed, even with one mount: the list mixes files
            // from every mount and has no section headers to say which.
            const path = thread.repoAlias === '.' ? thread.path : `${thread.repoAlias}/${thread.path}`;
            return (
              <div key={thread.id} className="group flex items-center gap-0.5 rounded-control-sm hover:bg-hover">
                <Button
                  variant="ghost"
                  title="Show this comment in the diff"
                  onClick={() => onJump(thread)}
                  className="h-auto min-w-0 flex-1 justify-start py-1 text-start font-normal hover:not-disabled:bg-transparent"
                >
                  <span className="block truncate font-mono text-small text-fg" title={path}>
                    {path}
                    <span className="ml-1.5 text-fg-3">{reviewLineLabel(thread.startLine, thread.endLine)}</span>
                  </span>
                  <span className="block truncate text-small text-fg-3" title={first?.body}>
                    {first?.body ?? 'No comment yet'}
                  </span>
                </Button>
                <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                  {onSendOne && isSendable(thread) ? (
                    <IconButton
                      icon="send"
                      size="sm"
                      label="Send this comment to the agent"
                      disabled={busy}
                      onClick={() => onSendOne(thread.id)}
                    />
                  ) : null}
                  <IconButton icon="trash" size="sm" label="Delete this comment" onClick={() => onDelete(thread.id)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {onSendAll && sendable.length > 0 ? (
        <div className="border-t border-line-soft p-2">
          <Button variant="primary" size="sm" icon="send" fullWidth disabled={busy} onClick={onSendAll}>
            Send {sendable.length} to chat
          </Button>
        </div>
      ) : null}
      </PopoverPopup>
    </PopoverRoot>
  );
}

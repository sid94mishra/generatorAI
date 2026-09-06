// ────────────────────────────────────────────────────────────────
// ReviewCommentsPopover — every comment on this diff, in one list
// ────────────────────────────────────────────────────────────────
//
// Deliberately the same shape as the integrated browser's Comments popover
// (count badge on the toolbar → list → per-item send/delete → "Send all to
// chat"). Reviewing a diff and reviewing a rendered page are the same task
// with different anchors, so they should not be two different interfaces to
// learn.
//
// Threads also render inline under the line they belong to. This list is the
// answer to the question the inline cards cannot answer: "what have I got
// outstanding, across files I may have collapsed or scrolled past?"

import { MessageSquare, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button, Popover, PopoverTrigger, PopoverContent } from '@/components/ui/index.js';
import type { ReviewThread } from '@/types/review.js';

export interface ReviewCommentsPopoverProps {
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

export function ReviewCommentsPopover({
  threads,
  open,
  onOpenChange,
  onJump,
  onSendOne,
  onSendAll,
  onDelete,
  busy,
}: ReviewCommentsPopoverProps) {
  const total = threads.length;
  const sendable = threads.filter(isSendable);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="Comments — review every note and send them to the agent"
          aria-label={`Comments (${total})`}
          className={cn(
            'h-6 gap-1 rounded px-1.5 text-[11px] hover:bg-accent hover:text-current',
            total > 0 ? 'text-primary' : 'text-foreground',
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {total > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">
              {total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold">
            Comments {total > 0 ? `(${total})` : ''}
          </span>
        </div>
        <div className="h-px bg-border" />

        {total === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            Select lines in the diff and press the <span className="font-mono">+</span> in
            the gutter to comment on them.
          </p>
        ) : (
          <div className="max-h-[280px] overflow-y-auto py-1">
            {threads.map((thread) => {
              const first = thread.comments[0];
              const path =
                thread.repoAlias === '.'
                  ? thread.path
                  : `${thread.repoAlias}/${thread.path}`;
              const lines =
                thread.startLine === thread.endLine
                  ? `L${thread.startLine}`
                  : `L${thread.startLine}–${thread.endLine}`;
              return (
                <div
                  key={thread.id}
                  className="group flex items-start gap-2 px-3 py-1.5 hover:bg-accent/50"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onJump(thread)}
                    title="Show this comment in the diff"
                    className="block h-auto min-w-0 flex-1 rounded-none p-0 text-left font-normal text-foreground hover:bg-transparent hover:text-foreground"
                  >
                    <div className="truncate font-mono text-[11px]" title={path}>
                      {path}
                      <span className="ml-1 text-muted-foreground">{lines}</span>
                    </div>
                    <div
                      className="truncate text-[11px] text-muted-foreground"
                      title={first?.body}
                    >
                      {first?.body ?? 'No comment yet'}
                    </div>
                  </Button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                    {onSendOne && isSendable(thread) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onSendOne(thread.id)}
                        disabled={busy}
                        title="Send this comment to the agent"
                        aria-label="Send this comment to the agent"
                        className="text-primary hover:bg-primary/15 hover:text-primary"
                      >
                        <Send className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDelete(thread.id)}
                      title="Delete this comment"
                      aria-label="Delete this comment"
                      className="hover:text-danger"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {onSendAll && sendable.length > 0 && (
          <>
            <div className="h-px bg-border" />
            <div className="p-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onSendAll}
                disabled={busy}
                className="w-full justify-center"
                leftIcon={<Send className="h-3.5 w-3.5" />}
              >
                Send {sendable.length} to chat
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
